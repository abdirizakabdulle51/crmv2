import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Doc } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs.tsx";
import { Plus, LayoutGrid, List, Upload, FileText } from "lucide-react";
import KanbanBoard from "./_components/kanban-board.tsx";
import PipelineList from "./_components/pipeline-list.tsx";
import LeadDialog from "./_components/lead-dialog.tsx";
import LeadImportDialog from "./_components/lead-import-dialog.tsx";

export default function PipelinePage() {
  const navigate = useNavigate();
  const leads = useQuery(api.leads.list, {});
  const companies = useQuery(api.companies.list, {});
  const users = useQuery(api.users.listAll, {});

  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<Doc<"leads"> | null>(null);

  if (!leads || !companies || !users) {
    return (
      <div className="p-6 md:p-8 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full" />
        <div className="grid grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      </div>
    );
  }

  const handleCreate = () => {
    setEditingLead(null);
    setDialogOpen(true);
  };

  const handleEdit = (lead: Doc<"leads">) => {
    navigate(`/pipeline/${lead._id}`);
  };

  // Total pipeline value (excluding won/lost)
  const activePipelineValue = leads
    .filter((l) => l.stage !== "won" && l.stage !== "lost")
    .reduce((sum, l) => sum + l.potentialValue, 0);

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Opportunities</h1>
          <p className="text-muted-foreground mt-1">
            {leads.length} opportunities — Active pipeline:{" "}
            {new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: "USD",
              minimumFractionDigits: 0,
            }).format(activePipelineValue)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => navigate("/quotes")}>
            <FileText className="h-4 w-4 mr-2" />
            Opportunity Quotes
          </Button>
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Import CSV
          </Button>
          <Button onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-2" />
            New Opportunity
          </Button>
        </div>
      </div>

      <Tabs defaultValue="board">
        <TabsList>
          <TabsTrigger value="board" className="gap-2">
            <LayoutGrid className="h-4 w-4" />
            Board
          </TabsTrigger>
          <TabsTrigger value="list" className="gap-2">
            <List className="h-4 w-4" />
            List
          </TabsTrigger>
        </TabsList>

        <TabsContent value="board" className="mt-4">
          <KanbanBoard
            leads={leads}
            companies={companies}
            users={users}
            onEditLead={handleEdit}
          />
        </TabsContent>

        <TabsContent value="list" className="mt-4">
          <PipelineList
            leads={leads}
            companies={companies}
            users={users}
            onEditLead={handleEdit}
          />
        </TabsContent>
      </Tabs>

      <LeadDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        lead={editingLead}
        companies={companies}
        users={users}
      />

      <LeadImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
