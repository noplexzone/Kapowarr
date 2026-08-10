from pathlib import Path
from unittest import TestCase


class TestDockerWorkflowSafety(TestCase):
    def test_develop_tag_only_publishes_from_develop(self) -> None:
        workflow = Path('.github/workflows/docker.yml').read_text()
        self.assertIn("      - develop", workflow)
        self.assertNotIn("      - '**'", workflow)
        self.assertIn("if: github.ref == 'refs/heads/develop'", workflow)
