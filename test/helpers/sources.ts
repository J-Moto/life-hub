import type { FakeTaskSource } from "../../src/sources/fakes";
import type { TaskReader } from "../../src/sources/types";

/** The read part of a fake only. A handler that tries to write through it throws. */
export const readOnly = (t: FakeTaskSource): TaskReader => ({
  listOpenTasks: (projectId) => t.listOpenTasks(projectId),
  listHabits: (habitIds) => t.listHabits(habitIds),
  listCheckins: (habitIds, from, to) => t.listCheckins(habitIds, from, to),
});
