import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { ArrowLeft } from "lucide-react";
import { CompanyForm } from "./_components/company-dialog.tsx";

export default function CompanyDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const companyId = id as Id<"companies"> | undefined;

  const company = useQuery(
    api.companies.getById,
    companyId ? { id: companyId } : "skip",
  );
  const countries = useQuery(api.countries.list, {});
  const sectors = useQuery(api.sectors.list, {});
  const users = useQuery(api.users.listAll, {});

  const goBack = () => navigate("/companies");

  if (!company || !countries || !sectors || !users) {
    return (
      <div className="space-y-4 p-6 md:p-8">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-[640px] w-full max-w-3xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 pb-20 md:p-8 md:pb-24">
      <Button variant="ghost" className="px-0" onClick={goBack}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Companies
      </Button>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Edit Company</h1>
        <p className="mt-1 text-muted-foreground">{company.name}</p>
      </div>

      <Card className="max-w-3xl">
        <CardContent className="pt-6">
          <CompanyForm
            company={company}
            countries={countries}
            sectors={sectors}
            users={users}
            onFinished={goBack}
          />
        </CardContent>
      </Card>

      <div className="h-12" aria-hidden="true" />
    </div>
  );
}
