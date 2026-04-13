import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

const tiers = {
  small: {
    label: "Small",
    specs: {
      guests: "8,000",
      concurrent: "1,000",
      vps: "CX22 (2 vCPU, 4GB RAM)",
      pg: "2GB RAM",
      redis: "512MB",
      pgbouncerPool: "50",
      convex: "Free tier",
    },
    costs: [
      { name: "Hetzner CX22", price: "~$5/mo" },
      { name: "DigitalOcean Basic", price: "~$12/mo" },
      { name: "Redis (Upstash Free)", price: "$0" },
      { name: "Convex Free", price: "$0" },
    ],
    totalRange: "~$5-12/mo",
  },
  medium: {
    label: "Medium",
    specs: {
      guests: "30,000",
      concurrent: "5,000",
      vps: "CX32 (4 vCPU, 8GB RAM)",
      pg: "4GB RAM",
      redis: "1GB",
      pgbouncerPool: "100",
      convex: "Pro ($25/month)",
    },
    costs: [
      { name: "Hetzner CX32", price: "~$10/mo" },
      { name: "DigitalOcean Premium", price: "~$24/mo" },
      { name: "Redis (Upstash Pro)", price: "~$10/mo" },
      { name: "Convex Pro", price: "$25/mo" },
    ],
    totalRange: "~$45-59/mo",
  },
  large: {
    label: "Large",
    specs: {
      guests: "60,000",
      concurrent: "10,000",
      vps: "CX42 (8 vCPU, 16GB RAM)",
      pg: "8GB RAM",
      redis: "2GB",
      pgbouncerPool: "150",
      convex: "Pro ($25/month)",
    },
    costs: [
      { name: "Hetzner CX42", price: "~$20/mo" },
      { name: "DigitalOcean Premium", price: "~$48/mo" },
      { name: "Redis (Upstash Business)", price: "~$20/mo" },
      { name: "Convex Pro", price: "$25/mo" },
    ],
    totalRange: "~$65-93/mo",
  },
};

export function SizingGuide() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Infrastructure Sizing Guide</h1>
        <p className="mt-1 text-muted-foreground">
          Recommended configurations for your event scale
        </p>
      </div>

      <Tabs defaultValue="small">
        <TabsList>
          <TabsTrigger value="small">Small</TabsTrigger>
          <TabsTrigger value="medium">Medium</TabsTrigger>
          <TabsTrigger value="large">Large</TabsTrigger>
        </TabsList>

        {Object.entries(tiers).map(([key, tier]) => (
          <TabsContent key={key} value={key}>
            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Specifications</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <SpecRow label="Max Guests" value={tier.specs.guests} />
                  <SpecRow label="Concurrent Users" value={tier.specs.concurrent} />
                  <SpecRow label="VPS" value={tier.specs.vps} mono />
                  <SpecRow label="PostgreSQL" value={tier.specs.pg} mono />
                  <SpecRow label="Redis" value={tier.specs.redis} mono />
                  <SpecRow label="PgBouncer Pool" value={tier.specs.pgbouncerPool} mono />
                  <SpecRow label="Convex Plan" value={tier.specs.convex} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Estimated Cost</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {tier.costs.map((item) => (
                    <div key={item.name} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{item.name}</span>
                      <span className="font-mono font-medium">{item.price}</span>
                    </div>
                  ))}
                  <div className="border-t pt-3">
                    <div className="flex justify-between text-sm font-semibold">
                      <span>Total</span>
                      <span className="font-mono">{tier.totalRange}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        ))}
      </Tabs>

      <Alert variant="destructive">
        <AlertTriangle className="size-4" />
        <AlertDescription>
          <strong>Hostinger is NOT recommended</strong> due to reports of random
          account suspensions without notice.
        </AlertDescription>
      </Alert>

      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            <strong>Development/Staging:</strong> VPS + Dokploy + Convex free tier.
            Redis via Upstash free tier or Docker on Dokploy.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            <strong>Production:</strong> Swap Convex keys to Pro plan. Scale VPS
            and Redis based on the tier matching your event size.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Recommended providers: <strong>Hetzner</strong> (best value),{" "}
            <strong>DigitalOcean</strong> (debit card friendly). Vultr and AWS
            Lightsail are alternatives.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function SpecRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono font-medium" : "font-medium"}>
        {value}
      </span>
    </div>
  );
}
