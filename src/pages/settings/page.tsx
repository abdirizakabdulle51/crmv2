import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { useCrm } from "@/lib/crm-context.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog.tsx";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Globe, Factory, ShieldAlert } from "lucide-react";
import ServiceCatalogSection from "./_components/service-catalog-section.tsx";

export default function SettingsPage() {
  const { isAdmin } = useCrm();
  const countries = useQuery(api.countries.list, {});
  const sectors = useQuery(api.sectors.list, {});

  if (!countries || !sectors) {
    return (
      <div className="p-6 md:p-8 space-y-4">
        <Skeleton className="h-8 w-48" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="p-6 md:p-8">
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <ShieldAlert className="h-12 w-12 text-muted-foreground" />
          <h2 className="text-xl font-semibold">Access Restricted</h2>
          <p className="text-muted-foreground text-center max-w-md">
            Only CEO and Head of Business can manage settings. Contact your
            administrator if you need changes.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Manage countries, regions, industry sectors, and service catalog
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <CountriesSection countries={countries} />
        <SectorsSection sectors={sectors} />
      </div>

      <ServiceCatalogSection />
    </div>
  );
}

type Country = { _id: Id<"countries">; name: string; region: string };

function CountriesSection({ countries }: { countries: Country[] }) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<Id<"countries"> | null>(null);
  const [name, setName] = useState("");
  const [region, setRegion] = useState("");

  const createCountry = useMutation(api.countries.create);
  const updateCountry = useMutation(api.countries.update);
  const removeCountry = useMutation(api.countries.remove);

  const handleSave = async () => {
    if (!name.trim() || !region.trim()) {
      toast.error("Name and region are required");
      return;
    }
    try {
      if (editingId) {
        await updateCountry({ id: editingId, name: name.trim(), region: region.trim() });
        toast.success("Country updated");
      } else {
        await createCountry({ name: name.trim(), region: region.trim() });
        toast.success("Country added");
      }
      setOpen(false);
      resetForm();
    } catch {
      toast.error("Failed to save country");
    }
  };

  const handleEdit = (country: Country) => {
    setEditingId(country._id);
    setName(country.name);
    setRegion(country.region);
    setOpen(true);
  };

  const handleDelete = async (id: Id<"countries">) => {
    try {
      await removeCountry({ id });
      toast.success("Country removed");
    } catch {
      toast.error("Failed to remove country");
    }
  };

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setRegion("");
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-primary" />
          <CardTitle>Countries & Regions</CardTitle>
        </div>
        <Dialog
          open={open}
          onOpenChange={(v) => {
            setOpen(v);
            if (!v) resetForm();
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingId ? "Edit Country" : "Add Country"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Country Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. United Kingdom"
                />
              </div>
              <div className="space-y-2">
                <Label>Region</Label>
                <Input
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  placeholder="e.g. Europe"
                />
              </div>
              <Button className="w-full" onClick={handleSave}>
                {editingId ? "Update" : "Add Country"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {countries.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No countries configured yet
          </p>
        ) : (
          <div className="space-y-2">
            {countries.map((c) => (
              <div
                key={c._id}
                className="flex items-center justify-between rounded-md border px-3 py-2"
              >
                <div>
                  <div className="font-medium text-sm">{c.name}</div>
                  <div className="text-xs text-muted-foreground">{c.region}</div>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleEdit(c)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(c._id)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type Sector = { _id: Id<"sectors">; name: string };

function SectorsSection({ sectors }: { sectors: Sector[] }) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<Id<"sectors"> | null>(null);
  const [name, setName] = useState("");

  const createSector = useMutation(api.sectors.create);
  const updateSector = useMutation(api.sectors.update);
  const removeSector = useMutation(api.sectors.remove);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Sector name is required");
      return;
    }
    try {
      if (editingId) {
        await updateSector({ id: editingId, name: name.trim() });
        toast.success("Sector updated");
      } else {
        await createSector({ name: name.trim() });
        toast.success("Sector added");
      }
      setOpen(false);
      resetForm();
    } catch {
      toast.error("Failed to save sector");
    }
  };

  const handleEdit = (sector: Sector) => {
    setEditingId(sector._id);
    setName(sector.name);
    setOpen(true);
  };

  const handleDelete = async (id: Id<"sectors">) => {
    try {
      await removeSector({ id });
      toast.success("Sector removed");
    } catch {
      toast.error("Failed to remove sector");
    }
  };

  const resetForm = () => {
    setEditingId(null);
    setName("");
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Factory className="h-5 w-5 text-primary" />
          <CardTitle>Industry Sectors</CardTitle>
        </div>
        <Dialog
          open={open}
          onOpenChange={(v) => {
            setOpen(v);
            if (!v) resetForm();
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingId ? "Edit Sector" : "Add Sector"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Sector Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Financial Services"
                />
              </div>
              <Button className="w-full" onClick={handleSave}>
                {editingId ? "Update" : "Add Sector"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {sectors.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No sectors configured yet
          </p>
        ) : (
          <div className="space-y-2">
            {sectors.map((s) => (
              <div
                key={s._id}
                className="flex items-center justify-between rounded-md border px-3 py-2"
              >
                <div className="font-medium text-sm">{s.name}</div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleEdit(s)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(s._id)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
