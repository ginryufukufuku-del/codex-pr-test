import unittest
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class AppParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = set()
        self.scripts = []
        self.stylesheets = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if "id" in attributes:
            self.ids.add(attributes["id"])
        if tag == "script" and "src" in attributes:
            self.scripts.append(attributes["src"])
        if tag == "link" and attributes.get("rel") == "stylesheet":
            self.stylesheets.append(attributes["href"])


class AppStructureTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.parser = AppParser()
        cls.parser.feed((ROOT / "index.html").read_text(encoding="utf-8"))

    def test_required_elements_exist(self):
        required_ids = {
            "task-form",
            "task-input",
            "task-list",
            "task-template",
            "remaining-count",
            "clear-completed",
            "empty-state",
        }
        self.assertTrue(required_ids.issubset(self.parser.ids))

    def test_linked_assets_exist(self):
        assets = self.parser.scripts + self.parser.stylesheets
        self.assertEqual(assets, ["task-store.js", "app.js", "styles.css"])
        for asset in assets:
            self.assertTrue((ROOT / asset).is_file(), f"Missing asset: {asset}")

    def test_task_store_loads_before_app(self):
        self.assertEqual(self.parser.scripts, ["task-store.js", "app.js"])


if __name__ == "__main__":
    unittest.main()
