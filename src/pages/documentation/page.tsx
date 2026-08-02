import {
  isValidElement,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BookOpen, Lock, Plus, Search } from "lucide-react";
import { api } from "@/convex/_generated/api.js";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { useCrm } from "@/lib/crm-context.tsx";
import { toast } from "sonner";

type Visibility = "public" | "restricted";

type DraftSection = {
  slug: string;
  title: string;
  group: string;
  order: string;
  visibility: Visibility;
  content: string;
};

function isCeoOrHob(role: string | undefined) {
  return role === "ceo" || role === "head_of_business";
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function textFromChildren(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map(textFromChildren).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(children)) {
    return textFromChildren(children.props.children);
  }
  return "";
}

function formatUpdatedAt(value: number | undefined) {
  if (!value) return "Not yet updated";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function extractOutline(markdown: string) {
  return markdown
    .split("\n")
    .map((line) => {
      const match = /^(##|###)\s+(.+)$/.exec(line.trim());
      if (!match) return null;
      const text = match[2].replace(/[#*_`]/g, "").trim();
      return {
        id: slugify(text),
        text,
        level: match[1].length,
      };
    })
    .filter(
      (item): item is { id: string; text: string; level: number } =>
        item !== null && item.id.length > 0,
    );
}

function emptyDraft(order: number): DraftSection {
  return {
    slug: "",
    title: "",
    group: "Team Guide",
    order: String(order),
    visibility: "public",
    content: "",
  };
}

export default function DocumentationPage() {
  const { currentUser } = useCrm();
  const navigate = useNavigate();
  const { slug: routeSlug } = useParams<{ slug?: string }>();
  const canEdit = isCeoOrHob(currentUser?.role);
  const sections = useQuery(api.documentation.list, {});
  const upsertSection = useMutation(api.documentation.upsert);
  const [filter, setFilter] = useState("");
  const [localSelectedSlug, setLocalSelectedSlug] = useState<string | null>(
    null,
  );
  const [isEditing, setIsEditing] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [draft, setDraft] = useState<DraftSection>(() => emptyDraft(1));
  const selectedSlug = routeSlug ?? localSelectedSlug;
  const hasSelectedSlug = Boolean(selectedSlug);
  const selectedSlugExists =
    Boolean(selectedSlug) &&
    Boolean(sections?.some((section) => section.slug === selectedSlug));

  const selectedSection = useQuery(
    api.documentation.getBySlug,
    selectedSlug && selectedSlugExists && !isAdding
      ? { slug: selectedSlug }
      : "skip",
  );

  const filteredSections = useMemo(() => {
    const normalizedFilter = filter.trim().toLowerCase();
    return (sections ?? []).filter((section) =>
      normalizedFilter
        ? section.title.toLowerCase().includes(normalizedFilter)
        : true,
    );
  }, [filter, sections]);

  const groupedSections = useMemo(() => {
    const groups = new Map<string, typeof filteredSections>();
    for (const section of filteredSections) {
      const groupSections = groups.get(section.group) ?? [];
      groupSections.push(section);
      groups.set(section.group, groupSections);
    }
    return [...groups.entries()];
  }, [filteredSections]);

  const outline = useMemo(
    () => extractOutline(selectedSection?.content ?? draft.content),
    [draft.content, selectedSection?.content],
  );

  useEffect(() => {
    if (!sections || sections.length === 0 || routeSlug || localSelectedSlug) {
      return;
    }
    setLocalSelectedSlug(sections[0].slug);
  }, [localSelectedSlug, routeSlug, sections]);

  useEffect(() => {
    if (!selectedSection || isAdding || !isEditing) {
      return;
    }
    setDraft({
      slug: selectedSection.slug,
      title: selectedSection.title,
      group: selectedSection.group,
      order: String(selectedSection.order),
      visibility: selectedSection.visibility,
      content: selectedSection.content,
    });
  }, [isAdding, isEditing, selectedSection]);

  const startEditing = () => {
    if (!selectedSection) return;
    setIsAdding(false);
    setDraft({
      slug: selectedSection.slug,
      title: selectedSection.title,
      group: selectedSection.group,
      order: String(selectedSection.order),
      visibility: selectedSection.visibility,
      content: selectedSection.content,
    });
    setIsEditing(true);
  };

  const startAdding = () => {
    setIsAdding(true);
    setIsEditing(true);
    setDraft(emptyDraft((sections?.length ?? 0) + 1));
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setIsAdding(false);
  };

  const saveDraft = async () => {
    const slug = draft.slug.trim() || slugify(draft.title);
    const order = Number(draft.order);
    if (!slug || !draft.title.trim() || !draft.group.trim()) {
      toast.error("Slug, title, and group are required");
      return;
    }
    if (!Number.isFinite(order)) {
      toast.error("Order must be a number");
      return;
    }

    try {
      await upsertSection({
        slug,
        title: draft.title.trim(),
        group: draft.group.trim(),
        content: draft.content,
        order,
        visibility: draft.visibility,
      });
      setLocalSelectedSlug(slug);
      navigate(`/documentation/${slug}`);
      setIsEditing(false);
      setIsAdding(false);
      toast.success("Documentation saved");
    } catch (error) {
      toast.error("Failed to save documentation", {
        description:
          error instanceof Error ? error.message : "Please try again",
      });
    }
  };

  if (!sections) {
    return (
      <div className="space-y-4 p-6 md:p-8">
        <Skeleton className="h-8 w-56" />
        <div className="grid gap-4 lg:grid-cols-[240px_1fr_220px]">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-background">
      <div className="border-b px-6 py-5 md:px-8">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-primary">
              <BookOpen className="h-4 w-4" />
              Documentation
            </div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">
              CRM Documentation
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Team workflows and internal technical reference.
            </p>
          </div>
          {canEdit ? (
            <Button onClick={startAdding}>
              <Plus className="mr-2 h-4 w-4" />
              Add Section
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid min-h-[calc(100vh-120px)] lg:grid-cols-[280px_minmax(0,1fr)_240px]">
        <aside className="border-b p-4 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              className="pl-9"
              placeholder="Search docs"
            />
          </div>

          <nav className="mt-5 space-y-6">
            {groupedSections.map(([group, groupSections]) => (
              <div key={group}>
                <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group}
                </div>
                <div className="space-y-1">
                  {groupSections.map((section) => (
                    <button
                      key={section.slug}
                      type="button"
                      onClick={() => {
                        setLocalSelectedSlug(section.slug);
                        navigate(`/documentation/${section.slug}`);
                        setIsEditing(false);
                        setIsAdding(false);
                      }}
                      className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors ${
                        selectedSlug === section.slug && !isAdding
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      <span>{section.title}</span>
                      {section.visibility === "restricted" ? (
                        <span className="flex items-center gap-1 text-[10px] uppercase">
                          <Lock className="h-3 w-3" />
                          Internal
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 px-6 py-8 md:px-10">
          <article className="mx-auto max-w-3xl">
            {isEditing ? (
              <div className="space-y-5">
                <div>
                  <h2 className="text-2xl font-bold">
                    {isAdding ? "Add Documentation Section" : "Edit Section"}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Changes save directly to Convex and do not require a code
                    deploy.
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="doc-slug">Slug</Label>
                    <Input
                      id="doc-slug"
                      value={draft.slug}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          slug: event.target.value,
                        }))
                      }
                      placeholder="section-slug"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="doc-title">Title</Label>
                    <Input
                      id="doc-title"
                      value={draft.title}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          title: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="doc-group">Group</Label>
                    <Input
                      id="doc-group"
                      value={draft.group}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          group: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="doc-order">Order</Label>
                    <Input
                      id="doc-order"
                      type="number"
                      value={draft.order}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          order: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>Visibility</Label>
                    <Select
                      value={draft.visibility}
                      onValueChange={(value) =>
                        setDraft((current) => ({
                          ...current,
                          visibility: value as Visibility,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="public">Public</SelectItem>
                        <SelectItem value="restricted">Restricted</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="doc-content">Content</Label>
                  <Textarea
                    id="doc-content"
                    value={draft.content}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        content: event.target.value,
                      }))
                    }
                    className="min-h-[420px] font-mono text-sm"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={cancelEditing}>
                    Cancel
                  </Button>
                  <Button onClick={saveDraft}>Save</Button>
                </div>
              </div>
            ) : hasSelectedSlug && !selectedSlugExists ? (
              <div className="rounded-lg border p-8 text-center">
                <h2 className="text-2xl font-bold tracking-tight">
                  Documentation article not found
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  The requested documentation article does not exist or is not
                  available to your role.
                </p>
                <Button
                  className="mt-5"
                  variant="outline"
                  onClick={() => {
                    setLocalSelectedSlug(sections[0]?.slug ?? null);
                    setIsEditing(false);
                    setIsAdding(false);
                    navigate("/documentation");
                  }}
                >
                  Back to Documentation
                </Button>
              </div>
            ) : selectedSection ? (
              <>
                <div className="mb-8 border-b pb-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        selectedSection.visibility === "restricted"
                          ? "secondary"
                          : "default"
                      }
                    >
                      {selectedSection.group}
                    </Badge>
                    {selectedSection.visibility === "restricted" ? (
                      <Badge variant="outline">Internal</Badge>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <h2 className="text-4xl font-bold tracking-tight">
                        {selectedSection.title}
                      </h2>
                      <p className="mt-3 text-sm text-muted-foreground">
                        Updated {formatUpdatedAt(selectedSection.updatedAt)}
                        {" by "}
                        {selectedSection.updatedByName ?? "System"}
                      </p>
                    </div>
                    {canEdit ? (
                      <Button variant="outline" onClick={startEditing}>
                        Edit
                      </Button>
                    ) : null}
                  </div>
                </div>

                <div className="docs-article">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      h2: ({ children }) => {
                        const text = textFromChildren(children);
                        return <h2 id={slugify(text)}>{children}</h2>;
                      },
                      h3: ({ children }) => {
                        const text = textFromChildren(children);
                        return <h3 id={slugify(text)}>{children}</h3>;
                      },
                    }}
                  >
                    {selectedSection.content}
                  </ReactMarkdown>
                </div>
              </>
            ) : (
              <div className="rounded-lg border p-8 text-center text-muted-foreground">
                No documentation sections are available yet.
              </div>
            )}
          </article>
        </main>

        {outline.length > 0 ? (
          <aside className="hidden border-l px-5 py-8 lg:block">
            <div className="sticky top-8">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                On this page
              </div>
              <nav className="mt-3 space-y-2">
                {outline.map((item) => (
                  <a
                    key={`${item.id}-${item.text}`}
                    href={`#${item.id}`}
                    className={`block text-sm text-muted-foreground transition-colors hover:text-primary ${
                      item.level === 3 ? "pl-4" : ""
                    }`}
                  >
                    {item.text}
                  </a>
                ))}
              </nav>
            </div>
          </aside>
        ) : (
          <div className="hidden lg:block" />
        )}
      </div>
    </div>
  );
}
