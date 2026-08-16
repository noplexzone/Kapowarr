from pathlib import Path
from unittest import TestCase


class TestDockerWorkflowSafety(TestCase):
    def test_develop_and_release_tags_are_separated_after_complete_ci_gate(self) -> None:
        workflow = Path('.github/workflows/tests.yml').read_text()
        self.assertIn("if: github.event_name == 'push' && (github.ref == 'refs/heads/develop'", workflow)
        self.assertIn('needs: [test, frontend]', workflow)
        self.assertIn('${IMAGE_NAME}:develop', workflow)
        self.assertIn('${IMAGE_NAME}:sha-${GITHUB_SHA}', workflow)
        self.assertIn('${IMAGE_NAME}:${tag_version}', workflow)
        self.assertIn('${IMAGE_NAME}:${minor}', workflow)
        self.assertIn('${IMAGE_NAME}:latest', workflow)
        self.assertIn('Git tag ${tag} does not match pyproject.toml version ${version}', workflow)
        self.assertIn('Refusing to overwrite existing Docker release tag', workflow)
        self.assertNotIn('noplexzone/kapowarr:${{ steps.version.outputs.value }}', workflow)
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
