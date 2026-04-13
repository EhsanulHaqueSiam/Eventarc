import { useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { Id } from "convex/_generated/dataModel";
import { api } from "convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Check, Copy, Link } from "lucide-react";

interface EventAccessTabProps {
  eventId: Id<"events">;
}

export function EventAccessTab({ eventId }: EventAccessTabProps) {
  const myAccess = useQuery(api.auth.getMyAccess);
  const permissions = useQuery(api.eventPermissions.listForEvent, { eventId });
  const createManagerAccount = useAction(api.eventPermissions.createManagerAccount);
  const revoke = useMutation(api.eventPermissions.revoke);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [canEdit, setCanEdit] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const managerRows = useMemo(() => permissions ?? [], [permissions]);

  const loginUrl = `${window.location.origin}/login`;

  const handleCreate = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      toast.error("Manager email is required");
      return;
    }
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    setIsSaving(true);
    try {
      const result = await createManagerAccount({
        eventId,
        email: normalizedEmail,
        password,
        canEdit,
      });
      if (result.created) {
        toast.success("Manager account created and assigned");
      } else {
        toast.success("Existing account assigned to event");
      }
      setEmail("");
      setPassword("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create manager");
    } finally {
      setIsSaving(false);
    }
  };

  const handleRevoke = async (permissionId: Id<"eventPermissions">) => {
    try {
      await revoke({ permissionId });
      toast.success("Manager access revoked");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to revoke manager");
    }
  };

  const handleCopyLink = (managerEmail: string) => {
    const text = `Login: ${loginUrl}\nEmail: ${managerEmail}`;
    navigator.clipboard.writeText(text);
    setCopiedId(managerEmail);
    toast.success("Login link copied");
    setTimeout(() => setCopiedId(null), 2000);
  };

  if (myAccess === undefined || permissions === undefined) {
    return <p className="text-sm text-muted-foreground">Loading access control...</p>;
  }

  if (!myAccess.isAdmin) {
    const currentPermission = (myAccess.eventPermissions ?? []).find(
      (permission) => permission.eventId === eventId,
    );
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Event Access</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>You are signed in as an event manager for this event.</p>
          <p>
            Access level:{" "}
            <span className="font-medium text-foreground">
              {currentPermission?.canEdit ? "Edit" : "View only"}
            </span>
          </p>
          <p>Only an admin can change event manager assignments.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create Event Manager</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="manager@example.com"
              type="email"
            />
            <Input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password (min 8 chars)"
              type="password"
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={canEdit}
                onCheckedChange={setCanEdit}
              />
              Can edit
            </label>
            <Button onClick={() => void handleCreate()} disabled={isSaving}>
              {isSaving ? "Creating..." : "Create & Assign"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Creates a login account for the manager and assigns them to this event.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Assigned Managers</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Access</TableHead>
                <TableHead>Link</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {managerRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                    No manager assigned to this event yet.
                  </TableCell>
                </TableRow>
              ) : (
                managerRows.map((permission) => (
                  <TableRow key={permission._id}>
                    <TableCell>{permission.email || "-"}</TableCell>
                    <TableCell>{permission.name || "-"}</TableCell>
                    <TableCell>{permission.canEdit ? "Edit" : "View"}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCopyLink(permission.email)}
                        title="Copy login link"
                      >
                        {copiedId === permission.email ? (
                          <Check className="h-4 w-4 text-green-600" />
                        ) : (
                          <Link className="h-4 w-4" />
                        )}
                      </Button>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleRevoke(permission._id)}
                      >
                        Revoke
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
