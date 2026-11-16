import type { CalendarEvent, CalendarSource, Habit, HabitCheckin, Task, TaskReader, TaskWriter } from "./types";

/** In-memory TickTick stand-in for tests and local dev, with both the read and the write part. Never used in production. */
export class FakeTaskSource implements TaskReader, TaskWriter {
  tasks: Task[];
  habits: Habit[];
  checkins: HabitCheckin[];
  private nextId = 1000;

  constructor(init?: { tasks?: Task[]; habits?: Habit[]; checkins?: HabitCheckin[] }) {
    this.tasks = init?.tasks ?? [];
    this.habits = init?.habits ?? [];
    this.checkins = init?.checkins ?? [];
  }

  async listOpenTasks(projectId: string): Promise<Task[]> {
    return this.tasks.filter((t) => t.projectId === projectId && !t.done).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async completeTask(projectId: string, taskId: string): Promise<void> {
    const t = this.tasks.find((x) => x.id === taskId && x.projectId === projectId);
    if (!t) throw new Error("task_not_found");
    t.done = true;
  }

  async createTask(projectId: string, title: string): Promise<Task> {
    const t: Task = { id: String(this.nextId++), projectId, title, done: false, sortOrder: this.tasks.length };
    this.tasks.push(t);
    return t;
  }

  async moveTask(taskId: string, fromProjectId: string, toProjectId: string): Promise<void> {
    const t = this.tasks.find((x) => x.id === taskId && x.projectId === fromProjectId);
    if (!t) throw new Error("task_not_found");
    t.projectId = toProjectId;
  }

  async listHabits(habitIds: string[]): Promise<Habit[]> {
    return this.habits.filter((h) => habitIds.includes(h.id));
  }

  async listCheckins(habitIds: string[], fromStamp: string, toStamp: string): Promise<HabitCheckin[]> {
    return this.checkins.filter((c) => habitIds.includes(c.habitId) && c.stamp >= fromStamp && c.stamp <= toStamp);
  }
}

export class FakeCalendarSource implements CalendarSource {
  constructor(public events: CalendarEvent[] = []) {}

  async listEvents(startIso: string, endIso: string): Promise<CalendarEvent[]> {
    return this.events.filter((e) => e.end > startIso && e.start < endIso).sort((a, b) => a.start.localeCompare(b.start));
  }
}

/** Sample data for local dev with USE_FAKES=true. */
export function sampleFakes(): { tasks: FakeTaskSource; calendar: FakeCalendarSource } {
  return {
    tasks: new FakeTaskSource({
      tasks: [
        { id: "t1", projectId: "today", title: "JOB: Open LinkedIn Jobs, apply to 1 role (done = 1 submitted)", done: false, sortOrder: 0 },
        { id: "t2", projectId: "today", title: "Open TikTok drafts, finish clinic video (done = posted)", done: false, sortOrder: 1 },
        { id: "n1", projectId: "next", title: "Open resume doc, tailor for AI role (done = saved PDF)", done: false, sortOrder: 0 },
      ],
      habits: [
        { id: "h-job", name: "Job action" },
        { id: "h-phone", name: "Phone-free morning" },
        { id: "h-home", name: "15-min home reset" },
      ],
      checkins: [],
    }),
    calendar: new FakeCalendarSource([]),
  };
}
