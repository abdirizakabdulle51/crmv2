import { useQuery } from "convex/react";
import { ArrowLeft } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/convex/_generated/api.js";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import QuoteCreateForm from "./_components/quote-create-dialog.tsx";

export default function NewOpportunityQuotePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const opportunityId = searchParams.get("opportunityId") ?? undefined;
  const companies = useQuery(api.companies.list, {});
  const leads = useQuery(api.leads.list, {});

  if (!companies || !leads) {
    return (
      <div className="space-y-4 p-6 md:p-8">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-[520px] w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 md:p-8">
      <Button
        variant="ghost"
        className="-ml-2"
        onClick={() =>
          navigate(opportunityId ? `/pipeline/${opportunityId}` : "/quotes")
        }
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back
      </Button>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Create Opportunity Quote
        </h1>
        <p className="mt-1 text-muted-foreground">
          Build the commercial proposal from catalogue pricing and connect it to
          the opportunity lifecycle.
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <Card>
          <CardContent className="p-6">
            <QuoteCreateForm
              companies={companies}
              leads={leads}
              initialOpportunityId={opportunityId}
              onCreated={(quoteId) => navigate(`/quotes/${quoteId}`)}
            />
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardContent className="space-y-4 p-5">
            <div className="font-medium">Guided sequence</div>
            {[
              "Select or create the proposal opportunity",
              "Choose PAYG or contracted outcome",
              "Add catalogue services and discounts",
              "Review the authoritative totals",
              "Save the linked draft quote",
            ].map((step, index) => (
              <div key={step} className="flex gap-3 text-sm">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
                  {index + 1}
                </div>
                <span className="text-muted-foreground">{step}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
