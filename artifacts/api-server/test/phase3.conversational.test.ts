import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { db, conversationMemoryTable } from "@workspace/db";
import {
  Phase2AgentRuntime,
  type ConversationMessage,
  type GatewayResponse,
  type ModelGateway,
} from "../src/lib/phase2.ts";
import { updateConversationState, type ConversationState } from "../src/lib/conversation-memory.ts";
import type { Identity } from "../src/lib/secretary.ts";

type ScriptedTurn = {
  callCount: number;
  toolNames: string[];
};

class ScriptedConversationalGateway implements ModelGateway {
  readonly provider = "groq" as const;
  readonly modelName = "scripted-groq";
  readonly turns: ScriptedTurn[] = [];
  private currentTurn: ScriptedTurn | null = null;
  private readonly personId = "11111111-1111-4111-8111-111111111111";
  private readonly projectId = "22222222-2222-4222-8222-222222222222";
  private readonly secondProjectId = "33333333-3333-4333-8333-333333333333";
  private readonly expenseId = "44444444-4444-4444-8444-444444444444";

  async generate(messages: ConversationMessage[]): Promise<GatewayResponse> {
    const currentMessage = [...messages]
      .reverse()
      .find((message) => message.role === "user" && message.text && !message.text.startsWith("["))
      ?.text ?? "";
    const toolMessages = messages.filter((message) => message.role === "tool");
    if (!this.currentTurn || this.currentTurn.message !== currentMessage) {
      this.currentTurn = { message: currentMessage, callCount: 0, toolNames: [] } as ScriptedTurn & { message: string };
      this.turns.push(this.currentTurn);
    }
    this.currentTurn.callCount += 1;

    const finish = (message: string): GatewayResponse => ({
      text: "",
      toolCalls: [{
        id: `final-${this.currentTurn!.callCount}`,
        name: "final_response",
        args: { kind: "answer", message },
      }],
    });
    const call = (name: string, args: Record<string, unknown>): GatewayResponse => {
      this.currentTurn!.toolNames.push(name);
      return {
        text: "",
        toolCalls: [{ id: `${name}-${this.currentTurn!.callCount}`, name, args }],
      };
    };

    if (currentMessage.includes("محمد خد مني 7500")) {
      if (toolMessages.length === 0) return call("find_person", { name: "محمد" });
      if (toolMessages.length === 1) return call("find_project", { name: "المحجر" });
      if (toolMessages.length === 2) {
        return call("record_expense", {
          amountMinor: 750000,
          description: "دفعة إلى محمد",
          personId: this.personId,
          projectId: this.projectId,
        });
      }
      return finish("سجلت الدفعة في المشروع المحدد.");
    }

    if (currentMessage.includes("مش المحجر ده")) {
      if (toolMessages.length === 0) return call("find_project", { name: "المحجر" });
      if (toolMessages.length === 1) {
        return call("update_expense", {
          expenseId: this.expenseId,
          amountMinor: 750000,
          projectId: this.secondProjectId,
        });
      }
      return finish("عدّلت المشروع إلى الاختيار الثاني.");
    }

    if (currentMessage.includes("خليهم 8000")) {
      if (toolMessages.length === 0) {
        return call("update_expense", { expenseId: this.expenseId, amountMinor: 800000 });
      }
      return finish("عدّلت المبلغ إلى القيمة الجديدة.");
    }

    if (currentMessage.includes("دفعت لمحمد كام")) {
      if (toolMessages.length === 0) return call("find_person", { name: "محمد" });
      if (toolMessages.length === 1) return call("get_person_expense_total", { personId: this.personId });
      return finish("راجعت إجمالي ما دُفع لمحمد.");
    }

    if (currentMessage.includes("فاكر الفلوس")) {
      if (toolMessages.length === 0) return call("recall_context", {});
      return finish("نعم، أتذكر سياق الدفعة من هذه المحادثة.");
    }

    if (currentMessage.includes("الشهر اللي فات")) {
      if (toolMessages.length === 0) return call("query_expenses", { period: "last_month", limit: 50 });
      return finish("عرضت مصروفات الشهر الماضي من البيانات المحفوظة.");
    }

    if (currentMessage.includes("أنهي مشروع")) {
      if (toolMessages.length === 0) return call("rank_expense_projects", {});
      return finish("راجعت ترتيب المشاريع حسب إجمالي قاعدة البيانات.");
    }

    if (currentMessage.includes("من غير المحجر")) {
      if (toolMessages.length === 0) return call("find_project", { name: "المحجر" });
      if (toolMessages.length === 1) {
        return call("rank_expense_projects", { excludeProjectId: this.projectId });
      }
      return finish("حسبت الإجمالي بعد استبعاد المحجر.");
    }

    return finish("فهمت طلبك.");
  }
}

test("Phase 3 keeps one natural conversation in LLM tool state and dry-runs writes", async () => {
  const gateway = new ScriptedConversationalGateway();
  const runtime = new Phase2AgentRuntime(gateway);
  const identity: Identity = {
    tenantId: `phase3-dry-run-${process.pid}-${Date.now()}`,
    userId: "phase3-user",
  };
  const conversationId = `phase3-conversation-${Date.now()}`;
  const messages = [
    "محمد خد مني 7500 في المحجر",
    "لأ، مش المحجر ده، المشروع التاني",
    "خليهم 8000",
    "أنا دفعت لمحمد كام؟",
    "فاكر الفلوس اللي اديتهاله؟",
    "طب وريني كل مصروفاتي الشهر اللي فات",
    "وأنهي مشروع صرفت فيه أكتر؟",
    "طب من غير المحجر",
  ];
  const results = [];

  for (const [index, message] of messages.entries()) {
    const result = await runtime.run(identity, {
      message,
      conversationId,
      requestId: `phase3-request-${index}`,
    }, { dryRun: true });
    results.push(result);
  }

  assert.equal(results.length, messages.length);
  assert.ok(results.every((result) => result.response?.kind === "answer"));
  assert.deepEqual(gateway.turns.map((turn) => turn.callCount), [4, 3, 2, 3, 2, 2, 2, 3]);
  assert.deepEqual(gateway.turns.map((turn) => turn.toolNames), [
    ["find_person", "find_project", "record_expense"],
    ["find_project", "update_expense"],
    ["update_expense"],
    ["find_person", "get_person_expense_total"],
    ["recall_context"],
    ["query_expenses"],
    ["rank_expense_projects"],
    ["find_project", "rank_expense_projects"],
  ]);

  const storedMemory = await db.select().from(conversationMemoryTable).where(and(
    eq(conversationMemoryTable.tenantId, identity.tenantId),
    eq(conversationMemoryTable.ownerUserId, identity.userId),
    eq(conversationMemoryTable.conversationId, conversationId),
  ));
  assert.equal(storedMemory.length, 0);
});

test("conversation state removes deleted structured entities instead of keeping stale references", () => {
  let state = {
    people: [],
    projects: [],
    candidatePeople: [],
    candidateProjects: [],
  } as ConversationState;
  state = updateConversationState(state, "find_person", {
    ok: true,
    matches: [{ id: "person-1", name: "محمد" }],
  });
  state = updateConversationState(state, "find_project", {
    ok: true,
    matches: [{ id: "project-1", name: "المحجر" }],
  });
  state = updateConversationState(state, "record_expense", {
    ok: true,
    expense: {
      id: "expense-1",
      amountMinor: 750000,
      currency: "EGP",
      personId: "person-1",
      projectId: "project-1",
    },
  });

  state = updateConversationState(state, "delete_expense", {
    ok: true,
    deleted: true,
    deletedExpense: { id: "expense-1" },
  });
  state = updateConversationState(state, "delete_person", {
    ok: true,
    deleted: true,
    deletedPerson: { id: "person-1" },
  });
  state = updateConversationState(state, "delete_project", {
    ok: true,
    deleted: true,
    deletedProject: { id: "project-1" },
  });

  assert.equal(state.lastExpense, undefined);
  assert.equal(state.lastPerson, undefined);
  assert.equal(state.lastProject, undefined);
  assert.deepEqual(state.people, []);
  assert.deepEqual(state.projects, []);
});
