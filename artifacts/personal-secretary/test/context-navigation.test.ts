import assert from "node:assert/strict";
import test from "node:test";
import { askAboutRecordHref, entityPath, recordContextPath } from "../src/lib/context-navigation.ts";

test("record context routes are read-only views and preserve the selected tab and id", () => {
  assert.equal(recordContextPath("tasks", "task/a"), "/records?tab=tasks&contextId=task%2Fa");
});

test("context Ask carries the exact saved record identity into the existing Ask route", () => {
  const href = askAboutRecordHref("reminder", "reminder-1", "موعد مع أحمد");
  const params = new URLSearchParams(href.split("?")[1]);
  assert.equal(href.startsWith("/ask?"), true);
  assert.equal(params.get("ask"), "اسألني عن موعد مع أحمد");
  assert.equal(params.get("entityType"), "reminder");
  assert.equal(params.get("entityId"), "reminder-1");
  assert.equal(params.get("entityName"), "موعد مع أحمد");
});

test("entity links preserve their existing typed destinations", () => {
  assert.equal(entityPath("person", "person/1"), "/people/person%2F1");
  assert.equal(entityPath("project", "project-1"), "/projects/project-1");
});
