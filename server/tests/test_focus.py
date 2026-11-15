from focus import focus_box
from teach import _parse_actions
from models import ReadLine

LINE = ReadLine(line_id="L2", problem_id="P1", latex="f'(x) = 6x + 1", plain="f'(x) = 6*x + 1",
                box=(200, 100, 260, 500), relation="derivative", confidence="high")


def test_focus_lands_on_the_right_end():
    ymin, xmin, ymax, xmax = focus_box(LINE.plain, list(LINE.box), "+ 1")
    assert (ymin, ymax) == (200, 260)          # same height as the line
    assert xmin > 380 and xmax == 500          # last characters of the line, not the whole line
    assert xmax - xmin < 150


def test_focus_ignores_spaces_and_times_signs():
    assert focus_box(LINE.plain, list(LINE.box), "6x") == focus_box(LINE.plain, list(LINE.box), "6 * x")


def test_focus_not_found_or_whole_line_gives_none():
    assert focus_box(LINE.plain, list(LINE.box), "cos") is None
    assert focus_box(LINE.plain, list(LINE.box), LINE.plain) is None
    assert focus_box(LINE.plain, list(LINE.box), "") is None


def test_parse_narrows_circle_but_not_note_and_drops_the_field():
    raw = [{"type": "circle", "line_id": "L2", "color": "red", "box": [1, 2, 3, 4], "focus": "+ 1"},
           {"type": "note", "line_id": "L2", "color": "red", "box": list(LINE.box), "text": "hm?", "focus": "+ 1"},
           {"type": "circle", "line_id": "L2", "color": "red", "box": list(LINE.box), "focus": "nope"}]
    circle, note, fallback = _parse_actions(raw, [LINE])
    assert circle.box[0] == 200 and circle.box[1] > 380   # rebuilt from the line's box, not the model's
    assert note.box == LINE.box
    assert fallback.box == LINE.box                       # focus not found: whole line
    assert not hasattr(circle, "focus")


def test_words_on_a_mark_become_a_note_and_empty_speech_is_dropped():
    raw = [{"type": "circle", "line_id": "L2", "color": "red", "box": list(LINE.box), "focus": "+ 1", "text": "What about $2x$?"},
           {"type": "speak"}, {"type": "speak", "text": "  "}]
    note, circle = _parse_actions(raw, [LINE])
    assert (note.type, note.text, note.box, note.color) == ("note", "What about $2x$?", LINE.box, "red")
    assert circle.type == "circle" and circle.text is None and circle.box[1] > 380


def test_existing_note_is_not_duplicated():
    raw = [{"type": "circle", "line_id": "L2", "color": "red", "box": list(LINE.box), "text": "dup"},
           {"type": "note", "line_id": "L2", "color": "red", "box": list(LINE.box), "text": "the real note"}]
    out = _parse_actions(raw, [LINE])
    assert [a.type for a in out] == ["circle", "note"] and out[0].text is None
