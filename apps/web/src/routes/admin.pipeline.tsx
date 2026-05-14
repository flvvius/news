import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "@news-app/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  Archive,
  Activity,
  CheckCircle2,
  DatabaseZap,
  GitMerge,
  Play,
  RefreshCcw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageLoadingState } from "@/components/ui/page-loading-state";

export const Route = createFileRoute("/admin/pipeline")({
  component: AdminPipelineRoute,
});

function formatNumber(value: number | undefined) {
  return new Intl.NumberFormat("en-US").format(value ?? 0);
}

function formatTime(value: number | undefined) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function pct(value: number | undefined) {
  return `${Math.round((value ?? 0) * 100)}%`;
}

function StatusChip({ status }: { status: string }) {
  const tone =
    status === "ok"
      ? "bg-success/10 text-success"
      : status === "error"
        ? "bg-destructive/10 text-destructive"
        : status === "degraded"
          ? "bg-warning/10 text-warning"
          : "bg-muted text-muted-foreground";
  return (
    <span className={`rounded-full px-2 py-1 text-xs font-medium ${tone}`}>
      {status}
    </span>
  );
}

function AdminPipelineRoute() {
  const funnel = useQuery(api.pipeline.getPipelineFunnelToday, {});
  const stuck = useQuery(api.pipeline.getStuckProcessingEvents, {});
  const health = useQuery(api.pipeline.getPipelineHealthSummary, {});
  const budget = useQuery(api.pipeline.getVectorBudgetStatus, {});
  const archived = useQuery(api.pipeline.getArchivedArticleStats, {});
  const alerts = useQuery(api.pipeline.getActiveAlerts, {});
  const triggerJob = useMutation(api.pipeline.triggerPipelineJob);
  const acknowledgeAlert = useMutation(api.pipeline.acknowledgeAlert);
  const setObservedQgb = useMutation(api.pipeline.setVectorObservedQgb);
  const [observedQgb, setObservedQgbInput] = useState("");
  const [jobFilter, setJobFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isBusy, setIsBusy] = useState<string | null>(null);

  const isLoading =
    funnel === undefined ||
    stuck === undefined ||
    health === undefined ||
    budget === undefined ||
    archived === undefined ||
    alerts === undefined;

  const filteredLogs = useMemo(() => {
    const rows = health?.latest ?? [];
    return rows.filter((row) => {
      if (jobFilter !== "all" && row.jobName !== jobFilter) return false;
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      return true;
    });
  }, [health?.latest, jobFilter, statusFilter]);

  const jobs = useMemo(
    () => Array.from(new Set((health?.latest ?? []).map((row) => row.jobName))),
    [health?.latest],
  );

  async function runJob(
    jobName:
      | "archiveStaleSingletonEvents"
      | "mergeNearDuplicateEvents"
      | "reclusterRecentSingletonEvents"
      | "clusterEnrichedArticles",
  ) {
    setIsBusy(jobName);
    try {
      await triggerJob({ jobName });
      toast.success(`${jobName} scheduled`);
    } catch (error) {
      console.error(error);
      toast.error(`Could not schedule ${jobName}`);
    } finally {
      setIsBusy(null);
    }
  }

  async function saveCalibration() {
    const parsed = Number(observedQgb);
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error("Enter a valid observed qGB value");
      return;
    }
    setIsBusy("calibration");
    try {
      await setObservedQgb({ observedQgb: parsed });
      toast.success("Calibration saved");
    } catch (error) {
      console.error(error);
      toast.error("Could not save calibration");
    } finally {
      setIsBusy(null);
    }
  }

  if (isLoading) {
    return (
      <PageLoadingState
        title="Loading pipeline"
        description="Collecting backend health signals."
        cardCount={4}
      />
    );
  }

  const queueTotal =
    (funnel.queues.unprocessed ?? 0) +
    (funnel.queues.enriched ?? 0) +
    (funnel.queues.processing ?? 0) +
    (funnel.queues.archived ?? 0);
  const budgetRatio = Math.min(Math.max(budget.ratio, 0), 1);

  return (
    <div className="bg-background">
      <div className="container mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              Admin
            </p>
            <h1 className="text-3xl font-bold tracking-tight">
              Pipeline Health
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => void runJob("clusterEnrichedArticles")}
              disabled={Boolean(isBusy)}
            >
              <Play className="size-4" />
              Cluster
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void runJob("mergeNearDuplicateEvents")}
              disabled={Boolean(isBusy)}
            >
              <GitMerge className="size-4" />
              Merge
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void runJob("reclusterRecentSingletonEvents")}
              disabled={Boolean(isBusy)}
            >
              <RefreshCcw className="size-4" />
              Recluster
            </Button>
            <Button
              type="button"
              onClick={() => void runJob("archiveStaleSingletonEvents")}
              disabled={Boolean(isBusy)}
            >
              <Archive className="size-4" />
              Archive
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Published Today</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-bold">
              {formatNumber(funnel.published)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Created Events</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-bold">
              {formatNumber(funnel.created)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Unprocessed Articles</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-bold">
              {formatNumber(funnel.queues.unprocessed)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Archived 24h</CardTitle>
            </CardHeader>
            <CardContent className="text-3xl font-bold">
              {formatNumber(archived.last24h)}
            </CardContent>
          </Card>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="size-5" />
                Today’s Funnel
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="h-4 overflow-hidden rounded-full bg-muted">
                {[
                  ["unprocessed", funnel.queues.unprocessed, "bg-warning"],
                  ["enriched", funnel.queues.enriched, "bg-primary"],
                  ["processing", funnel.queues.processing, "bg-accent"],
                  ["archived", funnel.queues.archived, "bg-muted-foreground"],
                ].map(([label, count, color]) => (
                  <span
                    key={label}
                    className={`inline-block h-full ${color}`}
                    style={{
                      width: `${queueTotal ? (Number(count) / queueTotal) * 100 : 0}%`,
                    }}
                  />
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-4">
                {Object.entries(funnel.queues).map(([label, count]) => (
                  <div key={label}>
                    <p className="text-xs uppercase text-muted-foreground">
                      {label}
                    </p>
                    <p className="text-xl font-semibold">
                      {formatNumber(count)}
                    </p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Updated {formatTime(funnel.updatedAt)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DatabaseZap className="size-5" />
                Vector Budget
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="mb-2 flex justify-between text-sm">
                  <span>{budget.usedQgb.toFixed(2)} qGB used</span>
                  <span>{budget.limitQgb.toFixed(2)} qGB limit</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${budgetRatio * 100}%` }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <span>Fallback runs: {formatNumber(budget.fallbackRuns)}</span>
                <span>Blocked runs: {formatNumber(budget.blockedRuns)}</span>
                <span>
                  Per search:{" "}
                  {Math.round(budget.calibratedPerSearchBytes / 1024 / 1024)} MB
                </span>
                <span>Source: {budget.calibrationSource}</span>
              </div>
              <div className="flex gap-2">
                <Input
                  aria-label="Observed qGB last 24 hours"
                  value={observedQgb}
                  onChange={(event) => setObservedQgbInput(event.target.value)}
                  placeholder="Observed qGB last 24h"
                  inputMode="decimal"
                />
                <Button
                  type="button"
                  onClick={() => void saveCalibration()}
                  disabled={isBusy === "calibration"}
                >
                  Save
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="size-5" />
                Active Alerts
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {alerts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active alerts.</p>
              ) : (
                alerts.map((alert) => (
                  <div
                    key={alert._id}
                    className="flex items-start justify-between gap-3 border-b border-border pb-3 last:border-b-0 last:pb-0"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <StatusChip status={alert.severity} />
                        <p className="font-medium">{alert.code}</p>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {alert.message}
                      </p>
                    </div>
                    <Button
                      aria-label={`Acknowledge alert ${alert.code}`}
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void acknowledgeAlert({ alertId: alert._id }).then(() =>
                          toast.success("Alert acknowledged"),
                        )
                      }
                    >
                      <CheckCircle2 className="size-4" />
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Stuck Processing Events</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-5 gap-2 text-sm">
                {Object.entries(stuck.buckets).map(([label, count]) => (
                  <div key={label}>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="font-semibold">{formatNumber(count)}</p>
                  </div>
                ))}
              </div>
              <div className="max-h-72 overflow-auto">
                {stuck.oldest.map((event) => (
                  <div
                    key={event._id}
                    className="border-b border-border py-2 text-sm last:border-b-0"
                  >
                    <p className="font-medium">{event.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatNumber(event.articleCount)} articles /{" "}
                      {formatNumber(event.sourceCount)} sources ·{" "}
                      {formatTime(event.lastArticleAt)}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="mt-4">
          <CardHeader>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <CardTitle>Latest Pipeline Runs</CardTitle>
              <div className="flex gap-2">
                <select
                  aria-label="Filter by job name"
                  value={jobFilter}
                  onChange={(event) => setJobFilter(event.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="all">All jobs</option>
                  {jobs.map((job) => (
                    <option key={job} value={job}>
                      {job}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Filter by status"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="all">All statuses</option>
                  <option value="ok">ok</option>
                  <option value="degraded">degraded</option>
                  <option value="skipped">skipped</option>
                  <option value="error">error</option>
                </select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="overflow-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2">Job</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Started</th>
                  <th className="py-2">Duration</th>
                  <th className="py-2">Counters</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => (
                  <tr key={log._id} className="border-t border-border">
                    <td className="py-2 font-medium">{log.jobName}</td>
                    <td className="py-2">
                      <StatusChip status={log.status} />
                    </td>
                    <td className="py-2">{formatTime(log.startedAt)}</td>
                    <td className="py-2">{formatNumber(log.durationMs)} ms</td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {JSON.stringify(log.counters).slice(0, 160)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
