(function exposeTaskStore(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.TaskStore = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createTaskStore() {
  function addTask(tasks, title, id = String(Date.now())) {
    const normalizedTitle = title.trim();

    if (!normalizedTitle) {
      return tasks;
    }

    return [...tasks, { id, title: normalizedTitle, completed: false }];
  }

  function toggleTask(tasks, id) {
    return tasks.map((task) =>
      task.id === id ? { ...task, completed: !task.completed } : task,
    );
  }

  function deleteTask(tasks, id) {
    return tasks.filter((task) => task.id !== id);
  }

  function clearCompleted(tasks) {
    return tasks.filter((task) => !task.completed);
  }

  function remainingCount(tasks) {
    return tasks.filter((task) => !task.completed).length;
  }

  return { addTask, toggleTask, deleteTask, clearCompleted, remainingCount };
});
