#!/usr/bin/env python3
"""AgenticPay SellerAgent unmodified — 23/25 structured vs prose.

Does not edit vendor seller_agent.py. Adapter = conversation_history message only.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
VENDOR = ROOT / ".vendor-agenticpay"
FIX = ROOT / "fixtures-nendet-2325.json"
OUT_DIR = ROOT / "runs"
AUTH = Path.home() / ".hermes" / "auth.json"
ONE = ROOT / "nendet-one.mjs"

sys.path.insert(0, str(VENDOR))


def load_token() -> str:
    data = json.loads(AUTH.read_text())
    return (
        data.get("providers", {})
        .get("xai-oauth", {})
        .get("tokens", {})
        .get("access_token")
        or ""
    ).strip()


def dql_call(pkt: dict) -> dict:
    import subprocess

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(pkt, f)
        path = f.name
    proc = subprocess.run(
        ["node", str(ONE), path],
        cwd=str(REPO),
        capture_output=True,
        text=True,
        env=os.environ.copy(),
        timeout=120,
    )
    Path(path).unlink(missing_ok=True)
    if proc.returncode != 0:
        return {"ok": False, "execute": False, "verdict": "ERROR", "stderr": (proc.stderr or "")[-300]}
    slim = json.loads(proc.stdout)
    slim["ok"] = True
    return slim


def permitted(objs: list) -> list:
    return [
        {
            "id": o.get("objection_id"),
            "code": o.get("code"),
            "severity": o.get("severity"),
            "missing_support": (o.get("message") or "")[:400],
            "permitted_repair": ["REVISE_CLAIM", "FRESH_EVIDENCE", "ESCALATE"],
        }
        for o in objs
    ]


def run_seller(token: str, case_id: str, user_text: str, draft: str) -> str:
    from agenticpay.agents.seller_agent import SellerAgent
    from agenticpay.models.openai_llm import OpenAILLM

    llm = OpenAILLM(model="grok-4-fast", api_key=token, base_url="https://api.x.ai/v1")
    seller = SellerAgent(model=llm)  # default role_description — do not add TP
    if case_id == "case23_incoterm_class":
        ctx = {
            "product_info": {
                "sku": "SKU-WIDGET-100",
                "name": "Widget 100",
                "unit_eur": 420,
            },
            "available_products": [
                {"name": "Widget 100", "brand": "Acme", "price": 420.0, "features": ["in stock"]}
            ],
            "environment_info": {
                "can_issue_shipping": [
                    "Seller arranges carriage; risk passes on tender to first carrier",
                    "Seller bears transit risk until scan at buyer dock",
                ]
            },
        }
        min_p = 300.0
    else:
        ctx = {
            "product_info": {
                "sku": "SKU-WIDGET-100",
                "name": "Widget 100",
                "unit_eur": 180,
            },
            "available_products": [
                {"name": "Widget 100", "brand": "Acme", "price": 180.0, "features": ["RoHS signed", "REACH signed"]}
            ],
            "environment_info": {
                "certificate_store": ["RoHS signed", "REACH signed"],
                "note": "No other signed certificates on file.",
            },
        }
        min_p = 120.0
    seller.seller_min_price = min_p
    seller.initialize(ctx)
    history = [
        {"role": "seller", "content": draft, "round": 1},
        {"role": "buyer", "content": user_text, "round": 2},
    ]
    return seller.respond(history, current_state={"round": 2, "num_buyers": 1})


def terminal(text: str, dql2: dict | None, case_id: str) -> str:
    if dql2 and dql2.get("execute") is True:
        return "ALLOW"
    if dql2 and dql2.get("execute") is False:
        return "BLOCK"
    # no resubmit
    return "HUMAN"


DRAFT = {
    "case23_incoterm_class": (
        "DRAFT_QUOTE_HOLD: 4× SKU-WIDGET-100 at EUR 420, total EUR 1680. "
        "DELIVERY: Seller arranges carriage; risk on tender to first carrier. No bind."
    ),
    "case25_partial_properties": (
        "DRAFT_OFFER_HOLD: 2× SKU-WIDGET-100 at EUR 180. Attached RoHS signed, REACH signed, "
        "datasheet excerpt typically rated to -20 C. No bind."
    ),
}


def main():
    if not os.environ.get("KEY_FILE"):
        raise SystemExit("set KEY_FILE")
    token = load_token()
    fixtures = json.loads(FIX.read_text())
    want = {"case23_incoterm_class", "case25_partial_properties"}
    rows = []
    for case in fixtures["cases"]:
        if case["id"] not in want:
            continue
        buyer1 = dql_call(case["buyer"])
        time.sleep(1.0)
        objs = buyer1.get("structured_objections") or []
        oid = objs[0].get("objection_id") if objs else None
        structured = json.dumps({"from": "counterparty", "payload": permitted(objs)}, ensure_ascii=False)
        prose = (
            "The buyer may have concerns about the Incoterm."
            if "incoterm" in case["id"]
            else "The buyer may have concerns about the certificate."
        )
        for arm, user_text in (("structured", structured), ("prose", prose)):
            t0 = time.time()
            try:
                reply = run_seller(token, case["id"], user_text, DRAFT[case["id"]])
                err = None
            except Exception as e:
                reply, err = "", f"{type(e).__name__}: {e}"[:400]
            ms = int((time.time() - t0) * 1000)
            dql2 = None
            # resubmit only if reply looks like a new draft, not empty
            if reply and err is None:
                dql2 = dql_call(
                    {
                        "mandate": case["buyer"]["mandate"],
                        "proposed_action": "DRAFT_PO_HOLD only (no bind): seller reply: " + reply[:1200],
                        "reasoning": "Buyer resubmits after AgenticPay seller turn.",
                        "context": f"agenticpay-blind {arm}",
                        "in_reply_to": oid,
                    }
                )
                time.sleep(1.0)
            term = terminal(reply, dql2, case["id"])
            rows.append(
                {
                    "id": case["id"],
                    "arm": arm,
                    "ms": ms,
                    "error": err,
                    "reply": (reply or "")[:1500],
                    "buyer1": {k: buyer1.get(k) for k in ("verdict", "receipt_id")},
                    "buyer2": None
                    if not dql2
                    else {k: dql2.get(k) for k in ("verdict", "execute", "receipt_id")},
                    "terminal": term,
                }
            )

    def p(cid, arm, expect):
        r = next(x for x in rows if x["id"] == cid and x["arm"] == arm)
        return r["terminal"] == expect

    out = {
        "started": datetime.now(timezone.utc).isoformat(),
        "vendor": "SAIL-Research-Lab/AgenticPay SellerAgent unmodified",
        "model": "grok-4-fast via OpenAILLM base_url xai",
        "rows": rows,
        "pass": {
            "23_structured": p("case23_incoterm_class", "structured", "ALLOW"),
            "23_prose": p("case23_incoterm_class", "prose", "ALLOW"),
            "25_structured": p("case25_partial_properties", "structured", "HUMAN"),
            "25_prose": p("case25_partial_properties", "prose", "HUMAN"),
        },
    }
    OUT_DIR.mkdir(exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    path = OUT_DIR / f"agenticpay-blind-{stamp}.json"
    path.write_text(json.dumps(out, indent=2))
    (OUT_DIR / "AGENTICPAY-BLIND-LATEST.json").write_text(json.dumps(out, indent=2))
    print(
        json.dumps(
            {
                "out": str(path),
                "pass": out["pass"],
                "per": [
                    {
                        "id": r["id"],
                        "arm": r["arm"],
                        "term": r["terminal"],
                        "err": r["error"],
                        "b2": (r["buyer2"] or {}).get("verdict"),
                        "reply": r["reply"][:180],
                    }
                    for r in rows
                ],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
