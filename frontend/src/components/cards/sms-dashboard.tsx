import { useCallback, useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { SMSStatusBadge } from "./sms-status-badge";
import { SMSTemplateEditor } from "./sms-template-editor";
import { Send, RefreshCw, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { trackEvent } from "@/lib/analytics";

interface SMSDashboardProps {
  eventId: Id<"events">;
}

interface SMSDelivery {
  _id: string;
  guestName: string;
  phone: string;
  status: "queued" | "sending" | "sent" | "delivered" | "failed";
  lastAttemptAt?: number;
}

interface SMSCounts {
  queued: number;
  sending: number;
  sent: number;
  delivered: number;
  failed: number;
  total: number;
}

const DEFAULT_MESSAGE_TEMPLATE =
  "Your EventArc invitation card is ready. Download it here: {cardUrl}";

function applySmsTemplate(
  template: string,
  sample: { name: string; phone: string; cardUrl: string },
): string {
  let message = template;
  const replacements: Record<string, string> = {
    "{cardUrl}": sample.cardUrl,
    "{link}": sample.cardUrl,
    "{name}": sample.name,
    "{guestName}": sample.name,
    "{phone}": sample.phone,
    "{number}": sample.phone,
  };

  for (const [token, value] of Object.entries(replacements)) {
    message = message.replaceAll(token, value);
  }
  return message;
}

export function SMSDashboard({ eventId }: SMSDashboardProps) {
  const [statusFilter, setStatusFilter] = useState<
    "all" | "queued" | "sending" | "sent" | "delivered" | "failed"
  >("all");
  const [isSending, setIsSending] = useState(false);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [messageTemplate, setMessageTemplate] = useState(DEFAULT_MESSAGE_TEMPLATE);
  const [progressCounts, setProgressCounts] = useState<
    SMSCounts | undefined
  >(undefined);
  const [isLoadingProgress, setIsLoadingProgress] = useState(true);
  const templateStorageKey = useMemo(
    () => `eventarc_sms_template:${eventId}`,
    [eventId],
  );

  const triggerSmsSend = useAction(api.adminGateway.triggerSmsSend);
  const triggerSmsRetryFailed = useAction(api.adminGateway.triggerSmsRetryFailed);
  const getSmsProgress = useAction(api.adminGateway.getSmsProgress);
  const upsertSmsTemplate = useMutation(api.smsTemplates.upsertForEvent);
  const persistedTemplate = useQuery(api.smsTemplates.getByEvent, { eventId });
  const deliveryRecords = useQuery(api.smsDeliveries.listByEvent, {
    eventId,
  });

  const refreshProgress = useCallback(async () => {
    try {
      const progress = await getSmsProgress({ eventId });
      setProgressCounts({
        queued: progress.queued,
        sending: 0,
        sent: progress.sent,
        delivered: progress.delivered,
        failed: progress.failed,
        total: progress.total,
      });
    } catch {
      // Progress endpoint can be empty before first send.
    } finally {
      setIsLoadingProgress(false);
    }
  }, [eventId, getSmsProgress]);

  useEffect(() => {
    if (persistedTemplate === undefined) {
      return;
    }
    if (persistedTemplate?.messageTemplate?.trim()) {
      setMessageTemplate(persistedTemplate.messageTemplate);
      return;
    }
    const savedTemplate = localStorage.getItem(templateStorageKey);
    if (savedTemplate?.trim()) {
      setMessageTemplate(savedTemplate);
      return;
    }
    setMessageTemplate(DEFAULT_MESSAGE_TEMPLATE);
  }, [persistedTemplate, templateStorageKey]);

  useEffect(() => {
    localStorage.setItem(templateStorageKey, messageTemplate);
  }, [templateStorageKey, messageTemplate]);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const progress = await getSmsProgress({ eventId });
        if (cancelled) return;
        setProgressCounts({
          queued: progress.queued,
          sending: 0,
          sent: progress.sent,
          delivered: progress.delivered,
          failed: progress.failed,
          total: progress.total,
        });
      } catch {
        // Ignore temporary errors and keep polling.
      } finally {
        if (!cancelled) {
          setIsLoadingProgress(false);
        }
      }
    };

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [eventId, getSmsProgress]);

  const deliveries: SMSDelivery[] | undefined = useMemo(() => {
    if (!deliveryRecords) return undefined;
    return deliveryRecords.map((delivery) => ({
      _id: delivery._id,
      guestName: delivery.guestName ?? "Unknown guest",
      phone: delivery.phone,
      status: delivery.status,
      lastAttemptAt: delivery.lastAttemptAt,
    }));
  }, [deliveryRecords]);

  const fallbackCounts: SMSCounts | undefined = useMemo(() => {
    if (!deliveries) return undefined;
    const counts: SMSCounts = {
      queued: 0,
      sending: 0,
      sent: 0,
      delivered: 0,
      failed: 0,
      total: deliveries.length,
    };
    for (const delivery of deliveries) {
      counts[delivery.status]++;
    }
    return counts;
  }, [deliveries]);

  const counts = progressCounts ?? fallbackCounts;
  const isLoading = isLoadingProgress && deliveryRecords === undefined;
  const templatePreview = useMemo(() => {
    const sample = deliveries?.[0];
    return applySmsTemplate(messageTemplate, {
      name: sample?.guestName ?? "Guest Name",
      phone: sample?.phone ?? "017XXXXXXXX",
      cardUrl: "https://cdn.example.com/card.png",
    });
  }, [deliveries, messageTemplate]);

  const filteredDeliveries =
    statusFilter === "all"
      ? deliveries
      : deliveries?.filter((delivery) => delivery.status === statusFilter);

  const saveTemplateToServer = useCallback(
    async (showSuccessToast: boolean): Promise<boolean> => {
      const trimmedTemplate = messageTemplate.trim();
      if (!trimmedTemplate) {
        toast.error("Message template is required");
        return false;
      }
      setIsSavingTemplate(true);
      try {
        await upsertSmsTemplate({
          eventId,
          messageTemplate: trimmedTemplate,
        });
        if (showSuccessToast) {
          toast.success("Template saved");
        }
        return true;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to save template";
        toast.error(message);
        return false;
      } finally {
        setIsSavingTemplate(false);
      }
    },
    [eventId, messageTemplate, upsertSmsTemplate],
  );

  const handleSaveTemplate = useCallback(async () => {
    await saveTemplateToServer(true);
  }, [saveTemplateToServer]);

  const handleSend = useCallback(async () => {
    const saved = await saveTemplateToServer(false);
    if (!saved) {
      return;
    }
    setIsSending(true);
    try {
      await triggerSmsSend({
        eventId,
        messageTemplate,
      });
      trackEvent("sms_batch_sent", { eventId });
      toast.success("SMS invitations queued for delivery");
      await refreshProgress();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to send invitations";
      trackEvent("sms_batch_failed", { eventId, reason: message });
      toast.error(message);
    } finally {
      setIsSending(false);
    }
  }, [
    eventId,
    messageTemplate,
    refreshProgress,
    saveTemplateToServer,
    triggerSmsSend,
  ]);

  const handleRetryFailed = useCallback(async () => {
    const saved = await saveTemplateToServer(false);
    if (!saved) {
      return;
    }
    setIsSending(true);
    try {
      await triggerSmsRetryFailed({
        eventId,
        messageTemplate,
      });
      trackEvent("sms_retry_failed", { eventId });
      toast.success("Retrying failed SMS deliveries");
      await refreshProgress();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to retry";
      toast.error(message);
    } finally {
      setIsSending(false);
    }
  }, [
    eventId,
    messageTemplate,
    refreshProgress,
    saveTemplateToServer,
    triggerSmsRetryFailed,
  ]);

  // Empty state
  if (!counts && !isLoading) {
    return (
      <div className="mx-auto max-w-lg space-y-6 py-12">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
            <MessageSquare className="size-6 text-muted-foreground" />
          </div>
          <h3 className="font-display text-lg font-semibold">Invitations not sent</h3>
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            Send SMS invitations with card download links to all guests.
            Delivery status is tracked per guest in real time.
          </p>
        </div>

        <SMSTemplateEditor
          messageTemplate={messageTemplate}
          onTemplateChange={setMessageTemplate}
          templatePreview={templatePreview}
          isSaving={isSavingTemplate}
          onSave={() => void handleSaveTemplate()}
        />

        <div className="flex justify-center">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button>
                <Send className="size-4" />
                Send Invitations
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Send SMS to all guests?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will send the SMS template above to all guests with card download links.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={isSending}
                  onClick={(e) => {
                    e.preventDefault();
                    void handleSend();
                  }}
                >
                  {isSending ? "Sending..." : "Send"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Queued</p>
            <p className="mt-1 font-display text-[28px] font-semibold leading-tight">
              {counts?.queued.toLocaleString() ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Sent</p>
            <p className="mt-1 font-display text-[28px] font-semibold leading-tight text-warning">
              {counts?.sent.toLocaleString() ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Delivered</p>
            <p className="mt-1 font-display text-[28px] font-semibold leading-tight text-success">
              {counts?.delivered.toLocaleString() ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Failed</p>
            <p className="mt-1 font-display text-[28px] font-semibold leading-tight text-destructive">
              {counts?.failed.toLocaleString() ?? 0}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Template editor (shared component) */}
      <SMSTemplateEditor
        messageTemplate={messageTemplate}
        onTemplateChange={setMessageTemplate}
        templatePreview={templatePreview}
        isSaving={isSavingTemplate}
        onSave={() => void handleSaveTemplate()}
      />

      <div className="flex items-center gap-2">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button>
              <Send className="size-4" />
              Send Invitations
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Send SMS to {counts?.total.toLocaleString()} guests?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This will send the current SMS template to all guests with their personalized card download links.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={isSending}
                onClick={(e) => {
                  e.preventDefault();
                  void handleSend();
                }}
              >
                {isSending ? "Sending..." : "Send"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {(counts?.failed ?? 0) > 0 && (
          <Button variant="outline" disabled={isSending} onClick={() => void handleRetryFailed()}>
            <RefreshCw className="size-4" />
            Retry Failed ({counts?.failed})
          </Button>
        )}
      </div>

      {/* Status filter tabs */}
      <Tabs value={statusFilter} onValueChange={setStatusFilter}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="queued">Queued</TabsTrigger>
          <TabsTrigger value="sent">Sent</TabsTrigger>
          <TabsTrigger value="delivered">Delivered</TabsTrigger>
          <TabsTrigger value="failed">Failed</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Delivery table */}
      <div className="rounded-xl shadow-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Guest</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sent At</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredDeliveries === undefined ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Skeleton className="h-4 w-32" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-28" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-20" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-24" />
                  </TableCell>
                </TableRow>
              ))
            ) : filteredDeliveries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    No delivery records yet
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              filteredDeliveries.map((delivery) => (
                <TableRow key={delivery._id}>
                  <TableCell className="font-medium">
                    {delivery.guestName}
                  </TableCell>
                  <TableCell>{delivery.phone}</TableCell>
                  <TableCell>
                    <SMSStatusBadge status={delivery.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {delivery.lastAttemptAt
                      ? new Date(delivery.lastAttemptAt).toLocaleString()
                      : "-"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
