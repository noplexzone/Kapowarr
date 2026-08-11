from pathlib import Path
from unittest import TestCase


class TestDockerWorkflowSafety(TestCase):
    def test_develop_tags_publish_only_after_the_complete_ci_gate(self) -> None:
        workflow = Path('.github/workflows/tests.yml').read_text()
        self.assertIn("if: github.event_name == 'push' && github.ref == 'refs/heads/develop'", workflow)
        self.assertIn('needs: [test, frontend]', workflow)
        self.assertIn('noplexzone/kapowarr:develop', workflow)
        self.assertIn('noplexzone/kapowarr:${{ steps.version.outputs.value }}', workflow)
        self.assertFalse(Path('.github/workflows/docker.yml').exists())

    def test_container_defaults_to_unraid_runtime_identity(self) -> None:
        dockerfile = Path('Dockerfile').read_text()
        compose = Path('docker-compose.yml').read_text()
        entrypoint = Path('entrypoint.sh').read_text()
        readme = Path('README.md').read_text()
        self.assertIn('USER 99:100', dockerfile)
        self.assertIn('user: "99:100"', compose)
        for content in (dockerfile, compose, entrypoint, readme):
            self.assertNotIn('PUID', content)
            self.assertNotIn('PGID', content)
        self.assertNotIn('groupmod', entrypoint)
        self.assertNotIn('usermod', entrypoint)
        self.assertNotIn('chown', entrypoint)

    def test_ci_runs_frontend_tests_build_budget_and_browser_gate(self) -> None:
        workflow = Path('.github/workflows/tests.yml').read_text()
        self.assertIn('frontend:', workflow)
        self.assertIn('npm ci', workflow)
        self.assertIn('npm test -- --run', workflow)
        self.assertIn('npm run build:check', workflow)
        self.assertIn('npm run test:e2e', workflow)

        dockerfile = Path('Dockerfile').read_text()
        self.assertIn('RUN npm test -- --run && npm run build:check', dockerfile)
