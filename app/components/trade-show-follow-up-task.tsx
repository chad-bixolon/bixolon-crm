import Link from 'next/link';
import type { TaskStatus } from '@prisma/client';
import { taskTiming } from '../lib/work';

type QueueTask = { id: number; subject: string; status: TaskStatus; dueDate: Date | null; assignedTo: { firstName: string; lastName: string } | null };
export function TradeShowFollowUpTask({ task, now = new Date() }: { task?: QueueTask; now?: Date }) {
  if (!task) return <span className="text-slate-500">No follow-up Task</span>;
  const timing = taskTiming(task, now);
  return <div className="space-y-1 break-words text-xs leading-5">
    <Link className="block font-semibold text-orange-800 underline" href={`/tasks/${task.id}`}>{task.subject}</Link>
    <div><strong>{task.status === 'IN_PROGRESS' ? 'In progress' : task.status === 'COMPLETED' ? 'Completed' : task.status === 'CANCELLED' ? 'Cancelled' : 'Open'}</strong>{timing && <span className="ml-2 font-semibold text-red-700">{timing}</span>}</div>
    <div>Task due: {task.dueDate?.toISOString().slice(0, 10) ?? 'No due date'}</div>
    <div>Task assignee: {task.assignedTo ? `${task.assignedTo.firstName} ${task.assignedTo.lastName}` : 'Unassigned'}</div>
    <Link className="inline-block text-orange-800 underline" href={`/tasks/${task.id}`}>Open Task</Link>
  </div>;
}
