import { useState } from "react";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import FolderRoundedIcon from "@mui/icons-material/FolderRounded";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { projectListState, type ProjectSummary } from "../lib/authProjects";
import { EmptyState, PageHeader, StatusChip, SurfaceCard } from "../components/ui";

interface ProjectsPageProps {
  projects: ProjectSummary[];
  loading: boolean;
  error: string | null;
  onCreate: (name: string, description: string) => Promise<void>;
  onUpdate: (projectId: string, name: string, description: string) => Promise<void>;
  onDelete: (projectId: string) => Promise<void>;
  onOpen: (projectId: string) => void;
  openingProjectId?: string | null;
  activeProjectId?: string | null;
  activeWorkflowStatus?: string;
}

export default function ProjectsPage({
  projects,
  loading,
  error,
  onCreate,
  onUpdate,
  onDelete,
  onOpen,
  openingProjectId = null,
  activeProjectId = null,
  activeWorkflowStatus = "Ready",
}: ProjectsPageProps) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectSummary | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const listState = projectListState(projects, loading, error);

  const openCreate = () => {
    setEditing(null);
    setName("");
    setDescription("");
    setDialogOpen(true);
  };

  const openEdit = (project: ProjectSummary) => {
    setEditing(project);
    setName(project.name);
    setDescription(project.description ?? "");
    setDialogOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      if (editing) await onUpdate(editing.project_id, name, description);
      else await onCreate(name, description);
      setDialogOpen(false);
    } catch {
      // Parent retains the API error and the inputs remain available.
    } finally {
      setSaving(false);
    }
  };

  const deleteProject = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await onDelete(deleteTarget.project_id);
      setDeleteTarget(null);
    } catch {
      // Parent presents the API error and confirmation remains open.
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Stack spacing={3}>
      <PageHeader
        eyebrow="WORKSPACES"
        title="My Projects"
        subtitle="Open or create a BESS study."
        action={<Button variant="contained" startIcon={<AddRoundedIcon />} onClick={openCreate}>New Project</Button>}
      />

      {error ? <Alert severity="error">{error}</Alert> : null}
      {listState === "loading" ? (
        <Typography color="text.secondary">Loading projects…</Typography>
      ) : listState === "empty" ? (
        <EmptyState
          icon={<FolderRoundedIcon sx={{ fontSize: 48 }} />}
          title="No projects yet"
          action={<Button variant="contained" startIcon={<AddRoundedIcon />} onClick={openCreate}>New Project</Button>}
        />
      ) : listState === "ready" ? (
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2,minmax(0,1fr))", xl: "repeat(3,minmax(0,1fr))" }, gap: 2 }}>
          {projects.map((project) => {
            const isActive = project.project_id === activeProjectId;
            return (
              <SurfaceCard key={project.project_id} sx={{ p: 2.5, minHeight: 280, display: "flex", flexDirection: "column" }}>
                <Box sx={{ width: 42, height: 42, display: "grid", placeItems: "center", borderRadius: 2.5, bgcolor: "rgba(155,239,74,.08)", color: "primary.main" }}>
                  <FolderRoundedIcon />
                </Box>
                <Typography variant="h6" sx={{ mt: 2 }}>{project.name}</Typography>
                <Stack direction="row" spacing={0.8} useFlexGap sx={{ mt: 1.2, flexWrap: "wrap" }}>
                  <StatusChip label={project.active_dataset_id ? "Dataset linked" : "No dataset"} tone={project.active_dataset_id ? "success" : "neutral"} />
                  <StatusChip label={isActive ? activeWorkflowStatus : "Ready to open"} tone={isActive ? "info" : "neutral"} />
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ mt: 2 }}>
                  Updated {new Date(project.updated_at).toLocaleString()}
                </Typography>
                <Stack spacing={1} sx={{ mt: "auto", pt: 2.5 }}>
                  <Button
                    fullWidth
                    variant={isActive ? "outlined" : "contained"}
                    startIcon={<OpenInNewRoundedIcon />}
                    disabled={project.status !== "active" || openingProjectId !== null}
                    onClick={() => onOpen(project.project_id)}
                  >
                    {openingProjectId === project.project_id ? "Opening project…" : "Open Project"}
                  </Button>
                  <Stack direction="row" spacing={1}>
                    <Button fullWidth variant="text" startIcon={<EditRoundedIcon />} onClick={() => openEdit(project)}>
                      Rename / Edit
                    </Button>
                    <Button fullWidth color="error" variant="text" startIcon={<DeleteOutlineRoundedIcon />} onClick={() => setDeleteTarget(project)}>
                      Delete
                    </Button>
                  </Stack>
                </Stack>
              </SurfaceCard>
            );
          })}
        </Box>
      ) : null}

      <Dialog open={dialogOpen} onClose={() => !saving && setDialogOpen(false)} fullScreen={fullScreen} fullWidth maxWidth="sm">
        <DialogTitle>{editing ? "Edit Project" : "New Project"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label="Project Name" value={name} onChange={(event) => setName(event.target.value)} required autoFocus />
            <TextField label="Description" value={description} onChange={(event) => setDescription(event.target.value)} multiline minRows={3} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={() => void save()} disabled={saving || !name.trim()}>{editing ? "Save" : "Create"}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onClose={() => !deleting && setDeleteTarget(null)} fullScreen={fullScreen} fullWidth maxWidth="xs">
        <DialogTitle>Delete Project</DialogTitle>
        <DialogContent><Typography>Remove “{deleteTarget?.name}” from My Projects?</Typography></DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => void deleteProject()} disabled={deleting}>{deleting ? "Deleting…" : "Delete Project"}</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
