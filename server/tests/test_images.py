import base64, io
import pytest
from PIL import Image
from images import decode_png, ImageError


def _b64(w, h):
    buf = io.BytesIO()
    Image.new("RGB", (w, h), "white").save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def test_shrinks_long_side():
    out = Image.open(io.BytesIO(decode_png(_b64(3000, 1000))))
    assert out.format == "PNG"
    assert max(out.size) == 1280
    assert out.size[1] in (426, 427)


def test_small_image_kept():
    out = Image.open(io.BytesIO(decode_png(_b64(400, 300))))
    assert out.size == (400, 300)


def test_data_url_prefix():
    out = Image.open(io.BytesIO(decode_png("data:image/png;base64," + _b64(100, 50))))
    assert out.size == (100, 50)


@pytest.mark.parametrize("bad", ["", "not base64 at all!!", base64.b64encode(b"hello world").decode()])
def test_rejects_non_images(bad):
    with pytest.raises(ImageError):
        decode_png(bad)
