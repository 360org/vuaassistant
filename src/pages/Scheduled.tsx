import { useState } from "react";
import { AlertCircle, BarChart3, CalendarClock, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Check, CheckCircle2, Columns3, Grid3X3, History, ListFilter, Pause, Play, Plus, Trash2, X } from "lucide-react";
import { useApp, type ScheduledTask, type TaskRunLog } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const inputClass =
  "w-full rounded-xl border border-neutral-700 bg-neutral-950 px-3 py-2 " +
  "text-sm outline-none placeholder:text-neutral-600 focus:border-gold-400/60";

const SCHEDULE_PRESETS = [
  "Every day at 9:00",
  "Every weekday at 8:00",
  "Every Monday at 9:00",
  "Every hour",
  "On the 1st of each month",
];

const TASK_VIEWS = [
  { id: "grid", label: "Grid", Icon: Grid3X3 },
  { id: "board", label: "Board", Icon: Columns3 },
  { id: "calendar", label: "Calendar", Icon: CalendarDays },
  { id: "list", label: "List", Icon: ListFilter },
  { id: "status", label: "Status", Icon: CheckCircle2 },
  { id: "charts", label: "Charts", Icon: BarChart3 },
] as const;

export function Scheduled() {
  const {
    scheduledTasks,
    taskTags,
    setTaskTags,
    taskRunLogs,
    addScheduledTask,
    updateScheduledTask,
    removeScheduledTask,
  } = useApp();
  const [editorOpen, setEditorOpen] = useState(false);
  const [view, setView] = useState<"board" | "calendar" | "grid" | "list" | "status" | "charts">("board");
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [configuringTaskId, setConfiguringTaskId] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const taskLogs = new Map<string, TaskRunLog>();
  for (const log of taskRunLogs) {
    if (!taskLogs.has(log.taskId)) taskLogs.set(log.taskId, log);
  }
  const tags = taskTags ?? [];
  const statusFor = (task: ScheduledTask) =>
    taskLogs.get(task.id)?.status === "error" ? "attention" : task.enabled ? "active" : "paused";
  const visibleTasks = scheduledTasks.filter(
    (task) =>
      (tagFilter === "all" || task.tags?.includes(tagFilter)) &&
      (statusFilter === "all" || statusFor(task) === statusFilter),
  );
  const columns = [
    {
      id: "active",
      title: "Đang chạy",
      description: "Sẽ chạy theo lịch",
      tasks: visibleTasks.filter((task) => statusFor(task) === "active" && !task.kanbanStatus),
    },
    {
      id: "paused",
      title: "Tạm dừng",
      description: "Chưa chạy lại",
      tasks: visibleTasks.filter((task) => statusFor(task) === "paused" && !task.kanbanStatus),
    },
    {
      id: "needs-attention",
      title: "Cần chú ý",
      description: "Lần chạy gần nhất lỗi",
      tasks: visibleTasks.filter((task) => statusFor(task) === "attention" && task.kanbanStatus !== "done"),
    },
    {
      id: "done",
      title: "Đã xong",
      description: "Task uỷ quyền hoàn thành",
      tasks: visibleTasks.filter((task) => task.kanbanStatus === "done"),
    },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-8 sm:py-10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Scheduled tasks</h1>
          <p className="mt-1 text-neutral-400">
            Let your assistant run jobs on a schedule and message you the
            results — daily summaries, reminders, reports.
          </p>
        </div>
        <Button onClick={() => setEditorOpen(true)}>
          <Plus className="size-4" /> New task
        </Button>
      </div>

      <nav className="mt-6 flex flex-wrap gap-1 border-b border-neutral-800" aria-label="Chế độ xem tác vụ">
        {TASK_VIEWS.map(({ id, label, Icon }) => {
          const active = view === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              className={`flex cursor-pointer items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-xs font-medium transition-colors ${active ? "border-gold-400 bg-gold-400/10 text-gold-300" : "border-transparent text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"}`}
            >
              <Icon className="size-3.5" /> {label}
            </button>
          );
        })}
      </nav>

      {scheduledTasks.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-2 border-b border-neutral-800 pb-4">
          <span className="mr-1 text-xs font-medium text-neutral-500">Lọc</span>
          <details className="relative">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-200 transition-colors hover:border-neutral-600 hover:bg-neutral-800">
              <ListFilter className="size-3.5 text-gold-300" />
              <span>{statusFilter === "all" ? "Trạng thái" : statusFilter === "active" ? "Đang chạy" : statusFilter === "paused" ? "Tạm dừng" : "Cần chú ý"}</span>
              <ChevronDown className="size-3.5 text-neutral-500" />
            </summary>
            <div className="absolute left-0 top-full z-20 mt-2 w-52 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-950 p-1.5 shadow-2xl shadow-black/50">
              <div className="flex items-center justify-between border-b border-neutral-800 px-2 py-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Trạng thái</span>
                <button onClick={() => setStatusFilter("all")} className="cursor-pointer text-[10px] text-gold-300 hover:text-gold-200">Bỏ chọn</button>
              </div>
              {[
                ["all", "Mọi trạng thái"],
                ["active", "Đang chạy"],
                ["paused", "Tạm dừng"],
                ["attention", "Cần chú ý"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStatusFilter(value)}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-neutral-300 transition-colors hover:bg-neutral-900"
                >
                  <span className={`flex size-4 items-center justify-center rounded border ${statusFilter === value ? "border-gold-400 bg-gold-400 text-neutral-950" : "border-neutral-600"}`}>
                    {statusFilter === value && <Check className="size-3" />}
                  </span>
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </details>
          <details className="relative">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-200 transition-colors hover:border-neutral-600 hover:bg-neutral-800">
              <span className="text-gold-300">#</span>
              <span>{tagFilter === "all" ? "Tag" : tagFilter}</span>
              <span className="text-[10px] text-neutral-500">{tagFilter === "all" ? `${tags.length}` : ""}</span>
              <ChevronDown className="size-3.5 text-neutral-500" />
            </summary>
            <div className="absolute left-0 top-full z-20 mt-2 w-56 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-950 p-1.5 shadow-2xl shadow-black/50">
              <div className="flex items-center justify-between border-b border-neutral-800 px-2 py-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Tag tác vụ</span>
                <button onClick={() => setTagFilter("all")} className="cursor-pointer text-[10px] text-gold-300 hover:text-gold-200">Bỏ chọn</button>
              </div>
              <button
                type="button"
                onClick={() => setTagFilter("all")}
                className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-neutral-300 transition-colors hover:bg-neutral-900"
              >
                <span className={`flex size-4 items-center justify-center rounded border ${tagFilter === "all" ? "border-gold-400 bg-gold-400 text-neutral-950" : "border-neutral-600"}`}>{tagFilter === "all" && <Check className="size-3" />}</span>
                Mọi tag
              </button>
              {tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setTagFilter(tag)}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-neutral-300 transition-colors hover:bg-neutral-900"
                >
                  <span className={`flex size-4 items-center justify-center rounded border ${tagFilter === tag ? "border-gold-400 bg-gold-400 text-neutral-950" : "border-neutral-600"}`}>{tagFilter === tag && <Check className="size-3" />}</span>
                  <span className="min-w-0 flex-1 truncate">#{tag}</span>
                  <span className="text-[10px] text-neutral-600">{scheduledTasks.filter((task) => task.tags?.includes(tag)).length}</span>
                </button>
              ))}
            </div>
          </details>
          {(tagFilter !== "all" || statusFilter !== "all") && (
            <button
              onClick={() => { setTagFilter("all"); setStatusFilter("all"); }}
              className="cursor-pointer rounded-lg px-2 py-1.5 text-xs text-gold-300 transition-colors hover:bg-gold-400/10 hover:text-gold-200"
            >
              Xóa lọc
            </button>
          )}
        </div>
      )}

      {scheduledTasks.length === 0 ? (
        <Card className="mt-8 flex flex-col items-center gap-2 py-12 text-center">
          <CalendarClock className="size-8 text-gold-300" />
          <div className="font-semibold">No scheduled tasks yet</div>
          <p className="max-w-sm text-sm text-neutral-500">
            Create a task like "Every day at 8:00, summarize my unread email
            and send it to Telegram."
          </p>
        </Card>
      ) : (
        <>
        {view === "board" && <div className="mt-6 grid gap-4 xl:grid-cols-4">
          {columns.map((column) => (
            <section
              key={column.id}
              className="min-w-0 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-3"
            >
              <div className="mb-3 flex items-start justify-between gap-2 px-1">
                <div>
                  <h2 className="text-sm font-semibold text-neutral-100">{column.title}</h2>
                  <p className="text-xs text-neutral-500">{column.description}</p>
                </div>
                <Badge tone={column.id === "needs-attention" ? "red" : column.id === "active" ? "green" : undefined}>
                  {column.tasks.length}
                </Badge>
              </div>

              <div className="flex min-h-28 flex-col gap-3">
                {column.tasks.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-neutral-800 px-3 py-5 text-center text-xs text-neutral-600">
                    Không có tác vụ
                  </p>
                ) : (
                  column.tasks.map((task) => {
                    const lastLog = taskLogs.get(task.id);
                    return (
                      <article
                        key={task.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setConfiguringTaskId(task.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setConfiguringTaskId(task.id);
                          }
                        }}
                        className="cursor-pointer rounded-xl border border-neutral-800 bg-neutral-950/70 p-3 shadow-sm transition-colors hover:border-gold-400/40 hover:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-gold-400/60"
                      >
                        <div className="flex items-start gap-2">
                          <span
                            className={
                              "flex size-8 shrink-0 items-center justify-center rounded-lg " +
                              (column.id === "needs-attention"
                                ? "bg-red-400/10 text-red-300"
                                : task.enabled
                                  ? "bg-gold-400/15 text-gold-300"
                                  : "bg-neutral-800 text-neutral-500")
                            }
                          >
                            <CalendarClock className="size-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <h3 className="line-clamp-2 text-sm font-medium text-neutral-100">{task.name}</h3>
                            <p className="mt-1 text-xs text-neutral-400">{task.schedule}</p>
                            {task.parentTaskId && (
                              <p className="mt-0.5 text-[10px] text-neutral-600">↳ sub-task</p>
                            )}
                          </div>
                        </div>
                        <p className="mt-3 line-clamp-3 text-xs leading-5 text-neutral-500">{task.prompt}</p>
                        {task.tags && task.tags.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-1">
                            {task.tags.map((tag) => (
                              <span key={tag} className="rounded-full bg-gold-400/10 px-2 py-0.5 text-[10px] font-medium text-gold-300">#{tag}</span>
                            ))}
                          </div>
                        )}
                        <div className="mt-3 flex items-center justify-between gap-2 border-t border-neutral-800 pt-2">
                          <span className="text-[11px] text-neutral-600">
                            {lastLog
                              ? `${lastLog.status === "error" ? "Lỗi" : "Lần chạy"}: ${new Date(lastLog.runAt).toLocaleString("vi-VN")}`
                              : task.lastRun
                                ? `Lần chạy: ${new Date(task.lastRun).toLocaleString("vi-VN")}`
                                : "Chưa chạy"}
                          </span>
                          <div className="flex items-center">
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                updateScheduledTask(task.id, { enabled: !task.enabled });
                              }}
                              className="cursor-pointer rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
                              title={task.enabled ? "Tạm dừng" : "Tiếp tục"}
                            >
                              {task.enabled ? <Pause className="size-4" /> : <Play className="size-4" />}
                            </button>
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedTaskId(task.id);
                              }}
                              className="cursor-pointer rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-800 hover:text-gold-300"
                              title="Lịch sử chạy"
                            >
                              <History className="size-4" />
                            </button>
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                removeScheduledTask(task.id);
                              }}
                              className="cursor-pointer rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-800 hover:text-red-400"
                              title="Xóa"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          ))}
        </div>}
        {view === "calendar" && (
          <TaskCalendar
            month={calendarMonth}
            tasks={visibleTasks}
            onMonthChange={setCalendarMonth}
            onOpenTask={setConfiguringTaskId}
            onNewTask={() => setEditorOpen(true)}
          />
        )}
        {view === "grid" && (
          <TaskGrid tasks={visibleTasks} onOpenTask={setConfiguringTaskId} />
        )}
        {view === "list" && (
          <TaskList tasks={visibleTasks} statusFor={statusFor} onOpenTask={setConfiguringTaskId} />
        )}
        {view === "status" && (
          <TaskStatus columns={columns} />
        )}
        {view === "charts" && (
          <TaskCharts logs={taskRunLogs} />
        )}
        </>
      )}

      {editorOpen && (
        <TaskEditor
          tags={tags}
          onCreateTag={(tag) => setTaskTags([...tags, tag])}
          onClose={() => setEditorOpen(false)}
          onSave={(task) => {
            addScheduledTask(task);
            setEditorOpen(false);
          }}
        />
      )}

      {selectedTaskId && (
        <TaskHistoryModal
          taskId={selectedTaskId}
          onClose={() => setSelectedTaskId(null)}
        />
      )}

      {configuringTaskId && (
        <TaskConfigModal
          task={scheduledTasks.find((task) => task.id === configuringTaskId) ?? null}
          tags={tags}
          onCreateTag={(tag) => setTaskTags([...tags, tag])}
          onClose={() => setConfiguringTaskId(null)}
          onSave={(task, patch) => {
            updateScheduledTask(task.id, patch);
            setConfiguringTaskId(null);
          }}
        />
      )}
    </div>
  );
}

function taskTime(schedule: string): string {
  const match = schedule.match(/(?:at|lúc|luc)?\s*(\d{1,2})[:h](\d{2})/i);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : "09:00";
}

function occursOn(task: ScheduledTask, day: Date): boolean {
  const schedule = task.schedule.toLowerCase();
  const iso = schedule.match(/(\d{4})-(\d{2})-(\d{2})/);
  const dmy = schedule.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/);
  if (iso) return day.getFullYear() === Number(iso[1]) && day.getMonth() === Number(iso[2]) - 1 && day.getDate() === Number(iso[3]);
  if (dmy) return day.getDate() === Number(dmy[1]) && day.getMonth() === Number(dmy[2]) - 1 && (!dmy[3] || day.getFullYear() === Number(dmy[3]));
  if (/every hour|hourly|hàng giờ|hang gio|mỗi giờ|moi gio/.test(schedule)) return true;
  if (/month|hàng tháng|hang thang|mỗi tháng|moi thang/.test(schedule)) return day.getDate() === 1;
  if (/weekday|ngày làm việc|ngay lam viec/.test(schedule)) return day.getDay() > 0 && day.getDay() < 6;
  const weekdays = [
    ["sunday", "chủ nhật", "chu nhat", "cn"], ["monday", "thứ hai", "thu hai", "t2"],
    ["tuesday", "thứ ba", "thu ba", "t3"], ["wednesday", "thứ tư", "thu tu", "t4"],
    ["thursday", "thứ năm", "thu nam", "t5"], ["friday", "thứ sáu", "thu sau", "t6"],
    ["saturday", "thứ bảy", "thu bay", "t7"],
  ];
  const namedDay = weekdays.findIndex((names) => names.some((name) => schedule.includes(name)));
  return namedDay < 0 || day.getDay() === namedDay;
}

function TaskCalendar({
  month,
  tasks,
  onMonthChange,
  onOpenTask,
  onNewTask,
}: {
  month: Date;
  tasks: ScheduledTask[];
  onMonthChange: (month: Date) => void;
  onOpenTask: (id: string) => void;
  onNewTask: () => void;
}) {
  const today = new Date();
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = new Date(first);
  gridStart.setDate(1 - first.getDay());
  const days = Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    return day;
  });
  const unscheduled = tasks.filter((task) => !task.schedule.trim());
  const monthLabel = month.toLocaleDateString("vi-VN", { month: "long", year: "numeric" });

  return (
    <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_17rem]">
      <section className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/40">
        <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-4 py-3">
          <Button variant="outline" size="sm" onClick={() => onMonthChange(new Date())}>Hôm nay</Button>
          <button onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="cursor-pointer rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100" aria-label="Tháng trước"><ChevronLeft className="size-4" /></button>
          <button onClick={() => onMonthChange(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="cursor-pointer rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100" aria-label="Tháng sau"><ChevronRight className="size-4" /></button>
          <h2 className="ml-1 text-sm font-semibold capitalize text-neutral-100">{monthLabel}</h2>
          <span className="ml-auto rounded-lg bg-gold-400/10 px-2.5 py-1 text-xs font-medium text-gold-300">Tháng</span>
        </div>
        <div className="grid grid-cols-7 border-l border-neutral-800">
          {["CN", "Th 2", "Th 3", "Th 4", "Th 5", "Th 6", "Th 7"].map((name) => <div key={name} className="border-b border-r border-neutral-800 px-2 py-2 text-center text-[11px] font-medium text-neutral-500">{name}</div>)}
          {days.map((day) => {
            const inMonth = day.getMonth() === month.getMonth();
            const isToday = day.toDateString() === today.toDateString();
            const due = tasks.filter((task) => task.enabled && occursOn(task, day));
            return (
              <div key={day.toISOString()} className={`min-h-28 border-b border-r border-neutral-800 p-2 ${inMonth ? "bg-neutral-950/25" : "bg-neutral-950/60"}`}>
                <span className={`flex size-6 items-center justify-center rounded-full text-xs ${isToday ? "bg-gold-400 font-semibold text-neutral-950" : inMonth ? "text-neutral-300" : "text-neutral-700"}`}>{day.getDate()}</span>
                <div className="mt-1 space-y-1">
                  {due.slice(0, 3).map((task) => <button key={task.id} onClick={() => onOpenTask(task.id)} className="block w-full cursor-pointer truncate rounded-md bg-gold-400/10 px-1.5 py-1 text-left text-[10px] text-gold-200 hover:bg-gold-400/20" title={task.name}>{taskTime(task.schedule)} · {task.name}</button>)}
                  {due.length > 3 && <span className="block px-1 text-[10px] text-neutral-500">+{due.length - 3} tác vụ</span>}
                </div>
              </div>
            );
          })}
        </div>
      </section>
      <aside className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4">
        <div className="flex items-center justify-between gap-2">
          <div><h2 className="text-sm font-semibold text-neutral-100">Chưa có lịch</h2><p className="text-xs text-neutral-500">Cần cấu hình trước khi chạy</p></div>
          <button onClick={onNewTask} className="cursor-pointer rounded-lg p-1.5 text-gold-300 hover:bg-gold-400/10" title="Thêm tác vụ"><Plus className="size-4" /></button>
        </div>
        <div className="mt-4 space-y-2">
          {unscheduled.length ? unscheduled.map((task) => <button key={task.id} onClick={() => onOpenTask(task.id)} className="w-full cursor-pointer rounded-xl border border-neutral-800 bg-neutral-950/70 p-3 text-left text-xs text-neutral-300 hover:border-gold-400/40"><span className="block font-medium text-neutral-100">{task.name}</span><span className="mt-1 block truncate text-neutral-500">{task.prompt}</span></button>) : <p className="rounded-xl border border-dashed border-neutral-800 px-3 py-8 text-center text-xs text-neutral-600">Mọi tác vụ đang có lịch.</p>}
        </div>
      </aside>
    </div>
  );
}

function TaskGrid({ tasks, onOpenTask }: { tasks: ScheduledTask[]; onOpenTask: (id: string) => void }) {
  return <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{tasks.map((task) => <button key={task.id} onClick={() => onOpenTask(task.id)} className="cursor-pointer rounded-2xl border border-neutral-800 bg-neutral-950/70 p-4 text-left transition-colors hover:border-gold-400/40"><span className="flex size-9 items-center justify-center rounded-xl bg-gold-400/15 text-gold-300"><CalendarClock className="size-4" /></span><h2 className="mt-3 line-clamp-2 text-sm font-semibold text-neutral-100">{task.name}</h2><p className="mt-1 text-xs text-neutral-400">{task.schedule}</p><p className="mt-3 line-clamp-3 text-xs leading-5 text-neutral-500">{task.prompt}</p>{task.tags?.length ? <div className="mt-3 flex flex-wrap gap-1">{task.tags.map((tag) => <span key={tag} className="rounded-full bg-gold-400/10 px-2 py-0.5 text-[10px] text-gold-300">#{tag}</span>)}</div> : null}</button>)}</div>;
}

function TaskList({ tasks, statusFor, onOpenTask }: { tasks: ScheduledTask[]; statusFor: (task: ScheduledTask) => string; onOpenTask: (id: string) => void }) {
  return <div className="mt-6 overflow-hidden rounded-2xl border border-neutral-800"><div className="grid grid-cols-[minmax(0,2fr)_minmax(8rem,1fr)_7rem] gap-3 border-b border-neutral-800 bg-neutral-900/60 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500"><span>Tác vụ</span><span>Lịch chạy</span><span>Trạng thái</span></div>{tasks.map((task) => <button key={task.id} onClick={() => onOpenTask(task.id)} className="grid w-full cursor-pointer grid-cols-[minmax(0,2fr)_minmax(8rem,1fr)_7rem] gap-3 border-b border-neutral-800 bg-neutral-950/40 px-4 py-3 text-left last:border-0 hover:bg-neutral-900"><span className="min-w-0"><span className="block truncate text-sm font-medium text-neutral-100">{task.name}</span><span className="block truncate text-xs text-neutral-500">{task.tags?.map((tag) => `#${tag}`).join(" · ") || task.prompt}</span></span><span className="truncate text-xs text-neutral-400">{task.schedule}</span><span className={`text-xs ${statusFor(task) === "attention" ? "text-red-300" : statusFor(task) === "active" ? "text-emerald-300" : "text-neutral-400"}`}>{statusFor(task) === "attention" ? "Cần chú ý" : statusFor(task) === "active" ? "Đang chạy" : "Tạm dừng"}</span></button>)}</div>;
}

function TaskStatus({ columns }: { columns: { id: string; title: string; description: string; tasks: ScheduledTask[] }[] }) {
  return <div className="mt-6 grid gap-4 md:grid-cols-3">{columns.map((column) => <Card key={column.id} className="p-5"><div className="flex items-center justify-between"><span className="text-sm font-medium text-neutral-300">{column.title}</span><Badge tone={column.id === "needs-attention" ? "red" : column.id === "active" ? "green" : "neutral"}>{column.tasks.length}</Badge></div><p className="mt-1 text-xs text-neutral-500">{column.description}</p><div className="mt-4 space-y-2">{column.tasks.slice(0, 5).map((task) => <div key={task.id} className="truncate rounded-lg bg-neutral-950 px-3 py-2 text-xs text-neutral-300">{task.name}</div>)}{column.tasks.length === 0 && <p className="text-xs text-neutral-600">Không có tác vụ.</p>}</div></Card>)}</div>;
}

function TaskCharts({ logs }: { logs: TaskRunLog[] }) {
  const completed = logs.filter((log) => log.status === "success" || log.status === "error");
  if (!completed.length) return <Card className="mt-6 flex flex-col items-center gap-2 py-16 text-center"><BarChart3 className="size-8 text-neutral-600" /><h2 className="text-sm font-semibold text-neutral-200">Chưa có dữ liệu chạy thực tế</h2><p className="max-w-sm text-xs text-neutral-500">Biểu đồ chỉ xuất hiện khi Scheduler ghi nhận lịch sử chạy thật; VuaAssistant không tạo số liệu mẫu.</p></Card>;
  const success = completed.filter((log) => log.status === "success").length;
  const failures = completed.length - success;
  const averageDuration = Math.round(completed.reduce((total, log) => total + log.duration, 0) / completed.length);
  return <div className="mt-6 grid gap-4 md:grid-cols-3"><Card className="p-5"><p className="text-xs text-neutral-500">Lần chạy thành công</p><p className="mt-2 text-3xl font-semibold text-emerald-300">{success}</p></Card><Card className="p-5"><p className="text-xs text-neutral-500">Lần chạy lỗi</p><p className="mt-2 text-3xl font-semibold text-red-300">{failures}</p></Card><Card className="p-5"><p className="text-xs text-neutral-500">Thời lượng trung bình</p><p className="mt-2 text-3xl font-semibold text-gold-300">{averageDuration}ms</p></Card></div>;
}

function TaskConfigModal({
  task,
  tags,
  onCreateTag,
  onClose,
  onSave,
}: {
  task: ScheduledTask | null;
  tags: string[];
  onCreateTag: (tag: string) => void;
  onClose: () => void;
  onSave: (task: ScheduledTask, patch: Partial<ScheduledTask>) => void;
}) {
  const [name, setName] = useState(task?.name ?? "");
  const [prompt, setPrompt] = useState(task?.prompt ?? "");
  const [schedule, setSchedule] = useState(task?.schedule ?? SCHEDULE_PRESETS[0]);
  const [selectedTags, setSelectedTags] = useState(task?.tags ?? []);
  const [newTag, setNewTag] = useState("");
  const [enabled, setEnabled] = useState(task?.enabled ?? true);
  const valid = Boolean(task && name.trim() && prompt.trim() && schedule.trim());

  if (!task) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-config-title"
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-gold-300">Cấu hình tác vụ</p>
            <h2 id="task-config-title" className="mt-1 text-lg font-semibold">{task.name}</h2>
            <p className="mt-1 text-xs text-neutral-500">Chỉnh cấu hình trước lần Agent chạy tiếp theo.</p>
          </div>
          <button onClick={onClose} className="cursor-pointer rounded-lg p-1 text-neutral-500 hover:bg-neutral-800" aria-label="Đóng">
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-5 space-y-4 overflow-y-auto pr-1">
          <label className="block text-xs text-neutral-400">
            Tên tác vụ
            <input className={`${inputClass} mt-1`} value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="block text-xs text-neutral-400">
            Agent cần thực hiện gì?
            <textarea className={`${inputClass} mt-1 min-h-28 resize-y`} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
          </label>
          <label className="block text-xs text-neutral-400">
            Lịch chạy
            <input className={`${inputClass} mt-1`} value={schedule} onChange={(event) => setSchedule(event.target.value)} list="schedule-presets" />
          </label>
          <div>
            <span className="block text-xs text-neutral-400">Tag phân loại</span>
            <div className="task-tag-picker mt-1">
              <div className="task-tag-options">
                {tags.map((tag) => {
                  const selected = selectedTags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setSelectedTags((current) => selected ? current.filter((item) => item !== tag) : [...current, tag])}
                      className={`task-tag-option ${selected ? "task-tag-option-selected" : ""}`}
                    >
                      <span className="task-tag-check">{selected && <Check className="size-3" />}</span>
                      <span>#{tag}</span>
                    </button>
                  );
                })}
                {tags.length === 0 && <p className="px-1 py-2 text-xs text-neutral-600">Chưa có tag chung. Tạo tag đầu tiên bên dưới.</p>}
              </div>
              <div className="task-tag-create">
                <input
                  value={newTag}
                  onChange={(event) => setNewTag(event.target.value)}
                  placeholder="Tạo tag dùng chung"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!newTag.trim()}
                  onClick={() => {
                    const tag = newTag.trim().toLowerCase();
                    if (!tag) return;
                    onCreateTag(tag);
                    setSelectedTags((current) => current.includes(tag) ? current : [...current, tag]);
                    setNewTag("");
                  }}
                >
                  Thêm tag
                </Button>
              </div>
            </div>
            <span className="mt-1 block text-[11px] text-neutral-500">Chọn từ danh mục chung; tag mới sẽ dùng lại được ở mọi tác vụ.</span>
          </div>
          <Card className="flex items-center justify-between gap-4 p-3">
            <div>
              <div className="text-sm font-medium text-neutral-100">{enabled ? "Đang chạy" : "Tạm dừng"}</div>
              <p className="mt-0.5 text-xs text-neutral-500">Tác vụ tạm dừng sẽ không được Scheduler kích hoạt.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label="Bật hoặc tạm dừng tác vụ"
              onClick={() => setEnabled((value) => !value)}
              className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${enabled ? "bg-emerald-500" : "bg-neutral-700"}`}
            >
              <span className={`absolute top-0.5 size-5 rounded-full bg-neutral-950 transition-all ${enabled ? "left-[22px]" : "left-0.5"}`} />
            </button>
          </Card>
        </div>

        <div className="mt-5 flex justify-end gap-2 border-t border-neutral-800 pt-4">
          <Button variant="ghost" size="sm" onClick={onClose}>Hủy</Button>
          <Button size="sm" disabled={!valid} onClick={() => onSave(task, {
            name: name.trim(),
            prompt: prompt.trim(),
            schedule: schedule.trim(),
            tags: selectedTags,
            enabled,
          })}>
            Lưu thay đổi
          </Button>
        </div>
      </div>
    </div>
  );
}

function TaskHistoryModal({
  taskId,
  onClose,
}: {
  taskId: string;
  onClose: () => void;
}) {
  const { taskRunLogs, clearTaskRunLogs, scheduledTasks } = useApp();
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const task = scheduledTasks.find((t) => t.id === taskId);
  const logs = taskRunLogs.filter((l) => l.taskId === taskId);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-neutral-800 bg-neutral-900 p-5 flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-lg text-neutral-250">Lịch sử chạy tác vụ</h2>
            <p className="text-xs text-neutral-400 mt-0.5">
              Task: {task?.name || "Unknown"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="cursor-pointer rounded-lg p-1 text-neutral-500 hover:bg-neutral-800"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-4 flex-1 overflow-y-auto min-h-[300px] flex flex-col gap-2.5 pr-1">
          {logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-neutral-500 flex-1">
              <History className="size-8 text-neutral-600 mb-2" />
              <div className="text-sm font-medium">Chưa có lịch sử chạy</div>
              <p className="text-xs text-neutral-600 max-w-xs mt-1">
                Nhật ký sẽ tự động xuất hiện khi tác vụ chạy lần đầu tiên theo lịch trình.
              </p>
            </div>
          ) : (
            logs.map((log) => {
              const isExpanded = expandedLogId === log.id;
              const formattedDate = new Date(log.runAt).toLocaleString("vi-VN");
              return (
                <div
                  key={log.id}
                  className="rounded-xl border border-neutral-800 bg-neutral-950/60 overflow-hidden transition-all duration-200"
                >
                  <div
                    onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none hover:bg-neutral-900/40"
                  >
                    {log.status === "success" ? (
                      <CheckCircle2 className="size-4 text-green-400 shrink-0" />
                    ) : log.status === "error" ? (
                      <AlertCircle className="size-4 text-red-400 shrink-0" />
                    ) : (
                      <span className="size-4 rounded-full border border-gold-400 border-t-transparent animate-spin shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-neutral-200 flex items-center gap-2">
                        {log.status === "success" ? "Thành công" : log.status === "error" ? "Thất bại" : "Đang chạy..."}
                        <span className="text-[10px] text-neutral-500 font-normal">
                          (Chạy hết {log.duration}ms)
                        </span>
                      </div>
                      <div className="text-xs text-neutral-500 mt-0.5">
                        {formattedDate}
                      </div>
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="size-4 text-neutral-500" />
                    ) : (
                      <ChevronDown className="size-4 text-neutral-500" />
                    )}
                  </div>
                  {isExpanded && (
                    <div className="border-t border-neutral-850 bg-black/40 p-4 font-mono text-xs text-neutral-350 whitespace-pre-wrap max-h-[250px] overflow-y-auto select-text break-words">
                      {log.output || "Không có dữ liệu log đầu ra."}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {logs.length > 0 && (
          <div className="mt-5 flex justify-between gap-2 border-t border-neutral-800 pt-4 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (confirm("Bạn có chắc chắn muốn xóa toàn bộ lịch sử chạy của tác vụ này?")) {
                  clearTaskRunLogs(taskId);
                }
              }}
              className="text-red-400 hover:text-red-300 hover:bg-red-400/10"
            >
              Xóa lịch sử
            </Button>
            <Button size="sm" onClick={onClose}>
              Đóng
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function TaskEditor({
  tags,
  onCreateTag,
  onClose,
  onSave,
}: {
  tags: string[];
  onCreateTag: (tag: string) => void;
  onClose: () => void;
  onSave: (task: Omit<ScheduledTask, "id" | "createdAt">) => void;
}) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [schedule, setSchedule] = useState(SCHEDULE_PRESETS[0]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");

  const valid = name.trim() !== "" && prompt.trim() !== "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">New scheduled task</h2>
          <button
            onClick={onClose}
            className="cursor-pointer rounded-lg p-1 text-neutral-500 hover:bg-neutral-800"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <label className="text-xs text-neutral-400">
            Name
            <input
              className={`${inputClass} mt-1`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Morning email summary"
            />
          </label>
          <label className="text-xs text-neutral-400">
            What should the assistant do?
            <textarea
              className={`${inputClass} mt-1 min-h-20 resize-y`}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Summarize my unread email and send it to Telegram."
            />
          </label>
          <label className="text-xs text-neutral-400">
            Schedule
            <input
              className={`${inputClass} mt-1`}
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              list="schedule-presets"
              placeholder="Every day at 9:00"
            />
            <datalist id="schedule-presets">
              {SCHEDULE_PRESETS.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </label>
          <div>
            <span className="text-xs text-neutral-400">Tags</span>
            <div className="task-tag-picker mt-1">
              <div className="task-tag-options">
                {tags.map((tag) => {
                  const selected = selectedTags.includes(tag);
                  return <button key={tag} type="button" onClick={() => setSelectedTags((current) => selected ? current.filter((item) => item !== tag) : [...current, tag])} className={`task-tag-option ${selected ? "task-tag-option-selected" : ""}`}><span className="task-tag-check">{selected && <Check className="size-3" />}</span>#{tag}</button>;
                })}
                {tags.length === 0 && <p className="px-1 py-2 text-xs text-neutral-600">Chưa có tag chung.</p>}
              </div>
              <div className="task-tag-create">
                <input value={newTag} onChange={(event) => setNewTag(event.target.value)} placeholder="Tạo tag dùng chung" />
                <Button type="button" variant="outline" size="sm" disabled={!newTag.trim()} onClick={() => { const tag = newTag.trim().toLowerCase(); if (!tag) return; onCreateTag(tag); setSelectedTags((current) => current.includes(tag) ? current : [...current, tag]); setNewTag(""); }}>Thêm tag</Button>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!valid}
            onClick={() =>
              onSave({
                name: name.trim(),
                prompt: prompt.trim(),
                schedule: schedule.trim() || "Every day at 9:00",
                tags: selectedTags,
                enabled: true,
              })
            }
          >
            Create task
          </Button>
        </div>
      </div>
    </div>
  );
}
