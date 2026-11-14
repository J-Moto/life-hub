/** What the dashboard needs from TickTick and Google. Real clients and fakes both implement these. */

export interface Task {
  id: string;
  projectId: string;
  title: string;
  done: boolean;
  sortOrder: number;
}

export interface Habit {
  id: string;
  name: string;
}

export interface HabitCheckin {
  habitId: string;
  /** Local date as YYYYMMDD, the format TickTick uses for check-ins. */
  stamp: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  /** ISO date-time, or YYYY-MM-DD for all-day events. */
  start: string;
  end: string;
  allDay: boolean;
}

export interface TaskSource {
  listOpenTasks(projectId: string): Promise<Task[]>;
  completeTask(projectId: string, taskId: string): Promise<void>;
  createTask(projectId: string, title: string): Promise<Task>;
  moveTask(taskId: string, fromProjectId: string, toProjectId: string): Promise<void>;
  listHabits(habitIds: string[]): Promise<Habit[]>;
  listCheckins(habitIds: string[], fromStamp: string, toStamp: string): Promise<HabitCheckin[]>;
}

export interface CalendarSource {
  /** Events overlapping the local day [startIso, endIso). */
  listEvents(startIso: string, endIso: string): Promise<CalendarEvent[]>;
}

export class NotConnectedError extends Error {
  constructor(public provider: "ticktick" | "google") {
    super(`${provider}_not_connected`);
  }
}
