// Lesson progress tracking via localStorage.

const LessonProgress = (() => {
  const STORAGE_KEY = 'robobuilder_progress';

  function getCompleted() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function complete(lessonId) {
    const done = getCompleted();
    if (!done.includes(lessonId)) {
      done.push(lessonId);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(done));
    }
  }

  function isComplete(lessonId) {
    return getCompleted().includes(lessonId);
  }

  // Sandbox unlocks when every lesson is completed.
  function isSandboxUnlocked() {
    const done = getCompleted();
    return LESSONS.every(l => done.includes(l.id));
  }

  function reset() {
    localStorage.removeItem(STORAGE_KEY);
  }

  return { complete, isComplete, isSandboxUnlocked, getCompleted, reset };
})();
