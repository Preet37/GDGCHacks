"""Time the read and teach steps on a generated page, per model. Usage: .venv/bin/python bench.py "line1|line2" model [model...]"""
import io, os, sys, time
from dotenv import load_dotenv
from PIL import Image, ImageDraw, ImageFont
from google import genai
from google.genai import types
import read, teach, verify
from models import CheckRequest, PageState

load_dotenv(".env")
import testpage
PNG = testpage.page(sys.argv[1].split("|"))
client = genai.Client(api_key=os.environ["GEMINI_API_KEY"], http_options=types.HttpOptions(timeout=40000))
for m in sys.argv[2:]:
    try:
        t = time.perf_counter(); lines = read.read_page(client, m, PNG, []); r = time.perf_counter() - t
        req = CheckRequest(image_base64="x", mode="auto", state=PageState(page_id="b"))
        t = time.perf_counter(); res = teach.teach(client, m, lines, req); te = time.perf_counter() - t
        print(f"{m}: read {r:.1f}s teach {te:.1f}s | " + "; ".join(f"{l.line_id} {l.relation} {l.plain!r} {list(l.box)}" for l in lines))
        print("   actions:", [(a.type, a.line_id, a.color, a.text) for a in res.actions], "| calls:", res.tool_calls, "| finished:", res.finished)
    except Exception as e:
        print(f"{m}: ERROR {str(e)[:160]}")
