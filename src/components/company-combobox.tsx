import { useState, type ReactNode } from "react";
import type { Doc, Id } from "@/convex/_generated/dataModel.d.ts";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command.tsx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover.tsx";
import { cn } from "@/lib/utils.ts";

type Company = Doc<"companies">;

type CompanyComboboxProps = {
  companies: Company[];
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  allLabel?: string;
  searchPlaceholder?: string;
  getCompanyMeta?: (company: Company) => ReactNode;
};

export function sortCompaniesByName(companies: Company[]) {
  return [...companies].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

export function CompanyCombobox({
  companies,
  value,
  onValueChange,
  className,
  allLabel = "All Companies",
  searchPlaceholder = "Search companies...",
  getCompanyMeta,
}: CompanyComboboxProps) {
  const [open, setOpen] = useState(false);
  const selectedCompany = companies.find(
    (company) => company._id === (value as Id<"companies">),
  );
  const selectedLabel = value === "all" ? allLabel : selectedCompany?.name;
  const sortedCompanies = sortCompaniesByName(companies);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-label="Company"
          aria-expanded={open}
          className={cn("w-full justify-between sm:w-[340px]", className)}
        >
          <span className="truncate">{selectedLabel || allLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>No companies found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value={allLabel}
                onSelect={() => {
                  onValueChange("all");
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4",
                    value === "all" ? "opacity-100" : "opacity-0",
                  )}
                />
                {allLabel}
              </CommandItem>
              {sortedCompanies.map((company) => {
                const meta = getCompanyMeta?.(company);

                return (
                  <CommandItem
                    key={company._id}
                    value={company.name}
                    onSelect={() => {
                      onValueChange(company._id);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === company._id ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="truncate">{company.name}</span>
                    {meta ? (
                      <Badge variant="outline" className="ml-auto text-[10px]">
                        {meta}
                      </Badge>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
