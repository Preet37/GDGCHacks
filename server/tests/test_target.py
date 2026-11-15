"""Which line the student is pointing at: their selection, or their latest ink (an underline under one part)."""
from explain import pick_target
from models import ReadLine
from target import pick_line


def _line(i, plain, box, problem, source="printed", relation="other"):
    return ReadLine(line_id=i, problem_id=problem, latex=plain, plain=plain, box=box, relation=relation,
                    confidence="high", source=source)


# A worksheet: a stem, three lettered parts, then a second numbered problem. Boxes are [ymin, xmin, ymax, xmax].
STEM = _line("L1", "1. Sketch the Bode plot for each transfer function", (100, 60, 130, 900), "P1")
A = _line("L2", "a) G(s) = 1/(s*(s+5))", (150, 100, 185, 480), "P1")
B = _line("L3", "b) G(s) = 10/(s+2)", (200, 100, 235, 450), "P2")
C = _line("L4", "c) G(s) = (s+1)/(s*(s+10))", (250, 100, 285, 520), "P3")
TWO = _line("L5", "2. Design a lead compensator for the plant", (400, 60, 430, 900), "P4")
SHEET = [STEM, A, B, C, TWO]


def test_an_underline_picks_the_printed_part_just_above_it():
    assert pick_line(SHEET, (188, 110, 193, 470)).line_id == "L2"      # drawn in the gap under part a
    assert pick_line(SHEET, (182, 110, 190, 470)).line_id == "L2"      # touching the bottom of part a
    assert pick_line(SHEET, (238, 100, 243, 440)).line_id == "L3"      # under part b
    assert pick_line(SHEET, (189, 110, 201, 470)).line_id == "L2"      # a thick stroke that only grazes the top of part b
    assert pick_line(SHEET, (286, 100, 290, 500)).line_id == "L4"
    # the lesson and the hint are then about that part alone, placed beside it
    problem, anchor, target = pick_target(SHEET, (188, 110, 193, 470))
    assert [l.line_id for l in problem] == ["L1", "L2"] and anchor.line_id == target.line_id == "L2"
    problem, anchor, target = pick_target(SHEET, (238, 100, 243, 440))
    assert [l.line_id for l in problem] == ["L3"] and anchor.line_id == "L3"


def test_a_selection_or_circle_picks_what_it_covers():
    assert pick_line(SHEET, (140, 80, 195, 500)).line_id == "L2"       # circled part a
    assert pick_line(SHEET, (195, 90, 290, 600)).line_id == "L3"       # covers b and c alike: the upper one
    assert pick_line(SHEET, (390, 50, 440, 950)).line_id == "L5"
    assert pick_line(SHEET, (150, 500, 185, 560)).line_id == "L2"      # a tick drawn just to the right of part a


def test_handwriting_wins_inside_a_selection_and_as_the_fallback():
    work = [_line("L6", "G(j*w) = 1/(j*w*(j*w+5))", (300, 120, 340, 600), "P3", "handwriting", "start"),
            _line("L7", "|G| = 1/(w*sqrt(w^2+25))", (350, 120, 390, 600), "P3", "handwriting", "equals")]
    page = SHEET[:4] + work + [TWO]
    assert pick_line(page, (240, 90, 395, 620)).line_id == "L7"        # selected part c and the work under it
    assert pick_line(page, (350, 120, 390, 600)).line_id == "L7"       # latest ink is the line just written
    problem, anchor, target = pick_target(page, (286, 100, 290, 500))  # underlined printed part c, which has work
    assert target.line_id == "L4" and anchor.line_id == "L7" and [l.line_id for l in problem] == ["L4", "L6", "L7"]
    assert pick_line(page).line_id == "L7"                             # nothing pointed at: the latest handwriting
    assert pick_line(page, (900, 900, 950, 950)).line_id == "L7"       # ink far from everything points at nothing


def test_with_no_handwriting_the_first_printed_problem_is_used_not_the_last():
    assert pick_line(SHEET).line_id == "L1"
    problem, anchor, target = pick_target(SHEET)
    assert [l.line_id for l in problem] == ["L1", "L2"] and anchor.line_id == "L1"
    assert pick_line(SHEET, (900, 900, 950, 950)).line_id == "L1"
    assert pick_line([]) is None and pick_target([]) == ([], None, None)
