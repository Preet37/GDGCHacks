import json, pathlib
from models import CheckResponse

EXAMPLES = pathlib.Path(__file__).resolve().parents[2] / "contract" / "examples"


def test_examples_load():
    files = sorted(EXAMPLES.glob("*.json"))
    assert len(files) >= 3
    for f in files:
        CheckResponse.model_validate(json.loads(f.read_text()))
