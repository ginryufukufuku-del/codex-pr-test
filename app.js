const STORAGE_KEY = "codex-pr-test.tasks";
const form = document.querySelector("#task-form");
const input = document.querySelector("#task-input");
const list = document.querySelector("#task-list");
const template = document.querySelector("#task-template");
const emptyState = document.querySelector("#empty-state");
const remainingLabel = document.querySelector("#remaining-count");
const clearButton = document.querySelector("#clear-completed");

let tasks = loadTasks();

function loadTasks() {
  try {
    const savedTasks = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(savedTasks) ? savedTasks : [];
  } catch {
    return [];
  }
}

function saveAndRender(nextTasks) {
  tasks = nextTasks;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  render();
}

function render() {
  list.replaceChildren();

  for (const task of tasks) {
    const item = template.content.firstElementChild.cloneNode(true);
    const toggle = item.querySelector(".task-toggle");
    const title = item.querySelector(".task-title");
    const deleteButton = item.querySelector(".delete-button");

    item.classList.toggle("completed", task.completed);
    toggle.checked = task.completed;
    title.textContent = task.title;
    deleteButton.setAttribute("aria-label", `「${task.title}」を削除`);

    toggle.addEventListener("change", () => {
      saveAndRender(TaskStore.toggleTask(tasks, task.id));
    });

    deleteButton.addEventListener("click", () => {
      saveAndRender(TaskStore.deleteTask(tasks, task.id));
    });

    list.append(item);
  }

  const remaining = TaskStore.remainingCount(tasks);
  remainingLabel.textContent =
    tasks.length === 0 ? "タスクはありません" : `残り ${remaining} 件`;
  emptyState.hidden = tasks.length > 0;
  clearButton.disabled = !tasks.some((task) => task.completed);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const nextTasks = TaskStore.addTask(tasks, input.value, crypto.randomUUID());

  if (nextTasks !== tasks) {
    saveAndRender(nextTasks);
    form.reset();
  }

  input.focus();
});

clearButton.addEventListener("click", () => {
  saveAndRender(TaskStore.clearCompleted(tasks));
});

render();
