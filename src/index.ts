import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const API_URL = 'https://api.thoughtproof.ai/v1/check';

const server = new Server(
  { name: 'thoughtproof-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'verify_reasoning',
      description:
        'Verify a decision or reasoning claim using ThoughtProof adversarial multi-model critique. Returns a verdict (ALLOW/HOLD/UNCERTAIN/DISSENT), confidence score, and up to 3 key objections.',
      inputSchema: {
        type: 'object',
        properties: {
          claim: {
            type: 'string',
            description: 'The decision or reasoning to verify',
          },
          stakeLevel: {
            type: 'string',
            enum: ['low', 'medium', 'high', 'critical'],
            default: 'medium',
            description: 'Stakes of the decision — affects confidence threshold',
          },
          domain: {
            type: 'string',
            enum: ['financial', 'medical', 'legal', 'code', 'general'],
            default: 'general',
            description: 'Domain context for the verification',
          },
        },
        required: ['claim'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'verify_reasoning') {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const { claim, stakeLevel = 'medium', domain = 'general' } =
    request.params.arguments as {
      claim: string;
      stakeLevel?: string;
      domain?: string;
    };

  let response: Response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claim, stakeLevel, domain }),
    });
  } catch (err) {
    return {
      content: [
        {
          type: 'text',
          text: `Network error reaching ThoughtProof API: ${(err as Error).message}`,
        },
      ],
      isError: true,
    };
  }

  // x402 payment required
  if (response.status === 402) {
    const body = await response.json().catch(() => ({}));
    const accepts = (body as any)?.accepts?.[0];
    const amount = accepts?.maxAmountRequired
      ? `${Number(accepts.maxAmountRequired) / 1_000_000} USDC`
      : 'a small USDC fee';
    return {
      content: [
        {
          type: 'text',
          text: [
            '**Payment required (x402)**',
            '',
            `ThoughtProof requires ${amount} per verification, paid on-chain via the x402 protocol.`,
            '',
            'To use this tool programmatically, attach an `X-PAYMENT` header with a valid Base USDC payment payload.',
            'See https://x402.org for client libraries.',
            '',
            accepts
              ? `Pay-to wallet: ${accepts.payTo}\nNetwork: ${accepts.network}\nAsset: ${accepts.asset}`
              : '',
          ]
            .join('\n')
            .trim(),
        },
      ],
      isError: false,
    };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => `HTTP ${response.status}`);
    return {
      content: [{ type: 'text', text: `ThoughtProof API error (${response.status}): ${text}` }],
      isError: true,
    };
  }

  const result = await response.json() as {
    verdict: string;
    confidence: number;
    objections: string[];
    durationMs: number;
  };

  const lines = [
    `**Verdict:** ${result.verdict}`,
    `**Confidence:** ${(result.confidence * 100).toFixed(1)}%`,
  ];

  if (result.objections?.length) {
    lines.push('', '**Key objections:**');
    result.objections.forEach((o, i) => lines.push(`${i + 1}. ${o}`));
  }

  lines.push('', `*Verified in ${result.durationMs}ms*`);

  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    isError: false,
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
