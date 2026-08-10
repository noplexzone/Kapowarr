from pathlib import Path
from unittest import TestCase


class TestDockerWorkflowSafety(TestCase):
    def test_develop_tag_only_publishes_from_develop(self) -> None:
        workflow = Path('.github/workflows/docker.yml').read_text()
        self.assertIn("      - develop", workflow)
        self.assertNotIn("      - '**'", workflow)
        self.assertIn("if: github.ref == 'refs/heads/develop'", workflow)

    def test_ci_runs_frontend_tests_and_build_budget(self) -> None:
        workflow = Path('.github/workflows/tests.yml').read_text()
        self.assertIn('frontend:', workflow)
        self.assertIn('npm ci', workflow)
        self.assertIn('npm test -- --run', workflow)
        self.assertIn('npm run build:check', workflow)

        dockerfile = Path('Dockerfile').read_text()
        self.assertIn('RUN npm test -- --run && npm run build:check', dockerfile)
