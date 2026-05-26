import unittest

from backend.base.definitions import Constants
from backend.implementations import getcomics


class GetComicsRateLimitTests(unittest.IsolatedAsyncioTestCase):
    async def test_search_getcomics_fetches_pages_through_paced_helper(self):
        calls = []
        original_gc_get_text = getcomics._gc_get_text

        html_by_url = {
            Constants.GC_SITE_URL: '''
                <span class="page-numbers">1</span>
                <a class="page-numbers">3</a>
                <article class="post">
                    <h1 class="post-title">
                        <a href="https://getcomics.org/example-1/">Example #1 (2024)</a>
                    </h1>
                </article>
            ''',
            f'{Constants.GC_SITE_URL}/page/2': '''
                <article class="post">
                    <h1 class="post-title">
                        <a href="https://getcomics.org/example-2/">Example #2 (2024)</a>
                    </h1>
                </article>
            ''',
            f'{Constants.GC_SITE_URL}/page/3': '''
                <article class="post">
                    <h1 class="post-title">
                        <a href="https://getcomics.org/example-3/">Example #3 (2024)</a>
                    </h1>
                </article>
            ''',
        }

        async def fake_gc_get_text(session, url, **kwargs):
            calls.append(url)
            return html_by_url[url]

        try:
            getcomics._gc_get_text = fake_gc_get_text
            results = await getcomics.search_getcomics(object(), 'Example')
        finally:
            getcomics._gc_get_text = original_gc_get_text

        self.assertEqual(
            calls,
            [
                Constants.GC_SITE_URL,
                f'{Constants.GC_SITE_URL}/page/2',
                f'{Constants.GC_SITE_URL}/page/3',
            ]
        )
        self.assertEqual(len(results), 3)


class GcGetTextBrowserUATests(unittest.IsolatedAsyncioTestCase):
    async def test_browser_useragent_injected_when_caller_omits_headers(self):
        """_gc_get_text must inject the browser UA even when the caller passes no headers."""
        captured = {}

        class FakeSession:
            async def get_text(self, url, headers=None, **kwargs):
                captured['headers'] = dict(headers or {})
                return ''

        original_last = getcomics._gc_last_request_at
        getcomics._gc_last_request_at = 0.0
        try:
            await getcomics._gc_get_text(FakeSession(), 'https://example.com')
        finally:
            getcomics._gc_last_request_at = original_last

        self.assertEqual(
            captured.get('headers', {}).get('User-Agent'),
            Constants.BROWSER_USERAGENT
        )

    async def test_caller_supplied_useragent_is_not_overridden(self):
        """A caller that explicitly passes User-Agent should keep it."""
        captured = {}
        custom_ua = 'MyCustomUA/1.0'

        class FakeSession:
            async def get_text(self, url, headers=None, **kwargs):
                captured['headers'] = dict(headers or {})
                return ''

        original_last = getcomics._gc_last_request_at
        getcomics._gc_last_request_at = 0.0
        try:
            await getcomics._gc_get_text(
                FakeSession(),
                'https://example.com',
                headers={'User-Agent': custom_ua}
            )
        finally:
            getcomics._gc_last_request_at = original_last

        self.assertEqual(captured.get('headers', {}).get('User-Agent'), custom_ua)


if __name__ == '__main__':
    unittest.main()
