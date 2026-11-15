import pytest


@pytest.fixture(autouse=True)
def _fresh_server_memory():
    """Nothing remembered about a page, and no request summaries, carry over from one test to the next."""
    import memory
    import pipeline
    memory.reset()
    pipeline.RECENT.clear()
    yield
