import type { Task } from "../data/Interfaces";

export type CurrentBarDateMode = "startFinishOverride" | "hybridActualEarly";

export type TaskBarSegmentKind = "current" | "started" | "scheduled";

export type TaskBarSegment = {
    kind: TaskBarSegmentKind;
    start: Date;
    finish: Date;
};

export type TaskBarGeometry = {
    isMilestone: boolean;
    milestoneDate: Date | null;
    segments: TaskBarSegment[];
    extentStart: Date | null;
    extentFinish: Date | null;
    labelStartDate: Date | null;
    labelFinishDate: Date | null;
    sortDate: Date | null;
    hasSplit: boolean;
};

export const currentBarDateModeItems = [
    { value: "startFinishOverride", displayName: "Start/Finish Override" },
    { value: "hybridActualEarly", displayName: "Hybrid Start + Early" }
] as const;

export function normalizeCurrentBarDateMode(value: unknown): CurrentBarDateMode {
    return value === "hybridActualEarly" ? "hybridActualEarly" : "startFinishOverride";
}

export function isTaskMilestone(task: Pick<Task, "type">): boolean {
    return task.type === "TT_Mile" || task.type === "TT_FinMile";
}

export function isValidTaskDate(value: Date | null | undefined): value is Date {
    return value instanceof Date && Number.isFinite(value.getTime());
}

export function getScheduleStart(task: Pick<Task, "startDate">): Date | null {
    return isValidTaskDate(task.startDate) ? task.startDate : null;
}

export function getScheduleFinish(task: Pick<Task, "finishDate">): Date | null {
    return isValidTaskDate(task.finishDate) ? task.finishDate : null;
}

function getOverrideStart(task: Pick<Task, "manualStartDate" | "startDate">): Date | null {
    return isValidTaskDate(task.manualStartDate)
        ? task.manualStartDate
        : getScheduleStart(task);
}

function getOverrideFinish(task: Pick<Task, "manualFinishDate" | "finishDate">): Date | null {
    return isValidTaskDate(task.manualFinishDate)
        ? task.manualFinishDate
        : getScheduleFinish(task);
}

function createSegment(kind: TaskBarSegmentKind, start: Date | null, finish: Date | null): TaskBarSegment | null {
    if (!isValidTaskDate(start) || !isValidTaskDate(finish) || finish < start) {
        return null;
    }

    return { kind, start, finish };
}

function getDefaultMilestoneDate(task: Task): Date | null {
    return getOverrideStart(task) ?? getOverrideFinish(task);
}

function getHybridMilestoneDate(task: Task): Date | null {
    if (task.type === "TT_FinMile") {
        return getScheduleFinish(task) ?? getScheduleStart(task) ?? getDefaultMilestoneDate(task);
    }

    return getScheduleStart(task) ?? getScheduleFinish(task) ?? getDefaultMilestoneDate(task);
}

function getDateMin(dates: Date[]): Date | null {
    if (dates.length === 0) {
        return null;
    }

    return dates.reduce((earliest, date) => date < earliest ? date : earliest, dates[0]);
}

function getDateMax(dates: Date[]): Date | null {
    if (dates.length === 0) {
        return null;
    }

    return dates.reduce((latest, date) => date > latest ? date : latest, dates[0]);
}

export function getCurrentTaskBarGeometry(
    task: Task,
    mode: CurrentBarDateMode,
    dataDate: Date | null | undefined
): TaskBarGeometry {
    const isMilestone = isTaskMilestone(task);
    const normalizedMode = normalizeCurrentBarDateMode(mode);

    if (isMilestone) {
        const milestoneDate = normalizedMode === "hybridActualEarly"
            ? getHybridMilestoneDate(task)
            : getDefaultMilestoneDate(task);

        return {
            isMilestone: true,
            milestoneDate,
            segments: [],
            extentStart: milestoneDate,
            extentFinish: milestoneDate,
            labelStartDate: milestoneDate,
            labelFinishDate: milestoneDate,
            sortDate: milestoneDate,
            hasSplit: false
        };
    }

    const defaultSegment = createSegment("current", getOverrideStart(task), getOverrideFinish(task));

    if (normalizedMode !== "hybridActualEarly") {
        const segments = defaultSegment ? [defaultSegment] : [];
        return buildGeometryFromSegments(segments, defaultSegment?.start ?? null, defaultSegment?.finish ?? null);
    }

    const earlyStart = getScheduleStart(task);
    const earlyFinish = getScheduleFinish(task);
    const scheduledSegment = createSegment("scheduled", earlyStart, earlyFinish);

    if (!scheduledSegment) {
        const segments = defaultSegment ? [defaultSegment] : [];
        return buildGeometryFromSegments(segments, defaultSegment?.start ?? null, defaultSegment?.finish ?? null);
    }

    const segments: TaskBarSegment[] = [];
    const actualStart = isValidTaskDate(task.manualStartDate) ? task.manualStartDate : null;
    const validDataDate = isValidTaskDate(dataDate) ? dataDate : null;
    const startedSegment = createSegment("started", actualStart, validDataDate);

    if (
        startedSegment &&
        startedSegment.start < startedSegment.finish &&
        startedSegment.finish <= scheduledSegment.start
    ) {
        segments.push(startedSegment);
    }

    segments.push(scheduledSegment);

    const labelStartDate = getOverrideStart(task) ?? scheduledSegment.start;

    return buildGeometryFromSegments(segments, labelStartDate, scheduledSegment.finish);
}

function buildGeometryFromSegments(
    segments: TaskBarSegment[],
    labelStartDate: Date | null,
    labelFinishDate: Date | null
): TaskBarGeometry {
    const dates = segments.flatMap(segment => [segment.start, segment.finish]);
    const extentStart = getDateMin(dates);
    const extentFinish = getDateMax(dates);
    const scheduledSegment = segments.find(segment => segment.kind === "scheduled");
    const sortDate = scheduledSegment?.start ?? extentStart;

    return {
        isMilestone: false,
        milestoneDate: null,
        segments,
        extentStart,
        extentFinish,
        labelStartDate,
        labelFinishDate,
        sortDate,
        hasSplit: segments.length > 1
    };
}
