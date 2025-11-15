import type { Lesson } from './types';

const USER_LESSONS_KEY = 'kotoba-user-lessons';

/**
 * Retrieves all user-created lessons from localStorage.
 * @returns An array of Lesson objects or an empty array if none are found or an error occurs.
 */
export const getUserLessons = (): Lesson[] => {
  try {
    const data = localStorage.getItem(USER_LESSONS_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error("Failed to parse user lessons from localStorage", error);
    // In case of corrupted data, clear it.
    localStorage.removeItem(USER_LESSONS_KEY);
    return [];
  }
};

/**
 * Saves an array of lessons to localStorage.
 * @param lessons The array of lessons to save.
 */
const saveUserLessons = (lessons: Lesson[]): void => {
  try {
    localStorage.setItem(USER_LESSONS_KEY, JSON.stringify(lessons));
  } catch (error) {
    console.error("Failed to save user lessons to localStorage", error);
  }
};

/**
 * Adds a new user-created lesson to localStorage.
 * @param newLesson The new lesson to save.
 */
export const saveUserLesson = (newLesson: Lesson): void => {
  const lessons = getUserLessons();
  lessons.push(newLesson);
  saveUserLessons(lessons);
};

/**
 * Deletes a user-created lesson from localStorage by its ID.
 * @param lessonId The ID of the lesson to delete.
 */
export const deleteUserLesson = (lessonId: string): void => {
  let lessons = getUserLessons();
  lessons = lessons.filter(lesson => lesson.id !== lessonId);
  saveUserLessons(lessons);
};
