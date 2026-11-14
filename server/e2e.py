"""Live end-to-end check against a running server. Usage: .venv/bin/python e2e.py [base_url]"""
import base64, json, sys, time, urllib.request
import testpage

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"


def post(body):
    t = time.time()
    req = urllib.request.Request(BASE + "/api/check", json.dumps(body).encode(), {"Content-Type": "application/json"})
    try:
        r = urllib.request.urlopen(req, timeout=90)
        return json.loads(r.read()), time.time() - t
    except urllib.error.HTTPError as e:
        return {"error": e.read().decode()[:300], "actions": [], "state": body["state"], "lines": [], "clear_line_ids": []}, time.time() - t


def img(lines):
    return base64.b64encode(testpage.page(lines)).decode()


wrong, right = img(["f(x) = 3x^2 + 2x", "f'(x) = 6x + 1"]), img(["f(x) = 3x^2 + 2x", "f'(x) = 6x + 2"])
b, dt = post({"image_base64": wrong, "mode": "auto", "state": {"page_id": "e2e"}})
print("AUTO   %.1fs" % dt, b.get("error") or json.dumps(b["actions"]), b.get("debug"))
b2, dt = post({"image_base64": wrong, "mode": "auto", "state": b["state"]})
print("REPEAT %.1fs" % dt, b2.get("error") or ("actions: %d clear: %s ids: %s" % (len(b2["actions"]), b2["clear_line_ids"], [l["line_id"] for l in b2["lines"]])))
b3, dt = post({"image_base64": right, "mode": "auto", "state": b2["state"]})
print("FIXED  %.1fs" % dt, b3.get("error") or ("actions: %s clear: %s flagged: %s" % (b3["actions"], b3["clear_line_ids"], b3["state"]["flagged_line_ids"])))
s = {"page_id": "h"}
for i in range(3):
    b4, dt = post({"image_base64": img(["d/dx (x sin x)"]), "mode": "help", "state": s})
    s = b4["state"]
    print("HELP%d  %.1fs" % (i + 1, dt), b4.get("error") or [(a["type"], a.get("text")) for a in b4["actions"]], s.get("problems"))
b5, dt = post({"image_base64": img(["g(x) = x^2 - 4", "graph this"]), "mode": "auto", "state": {"page_id": "g"}})
print("GRAPH  %.1fs" % dt, b5.get("error") or [(a["type"], a.get("figure")) for a in b5["actions"]])
