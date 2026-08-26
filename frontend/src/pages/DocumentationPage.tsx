import ArrowOutwardRoundedIcon from "@mui/icons-material/ArrowOutwardRounded";
import AutoGraphRoundedIcon from "@mui/icons-material/AutoGraphRounded";
import CloudUploadRoundedIcon from "@mui/icons-material/CloudUploadRounded";
import DescriptionRoundedIcon from "@mui/icons-material/DescriptionRounded";
import FactCheckRoundedIcon from "@mui/icons-material/FactCheckRounded";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import RocketLaunchRoundedIcon from "@mui/icons-material/RocketLaunchRounded";
import { Box, Button, Stack, Typography } from "@mui/material";
import type { SvgIconComponent } from "@mui/icons-material";

import { PageHeader, SurfaceCard } from "../components/ui";
import { documentationUrl } from "../lib/documentationLinks";

interface DocumentationCard {
  title: string;
  description: string;
  path: string;
  icon: SvgIconComponent;
}

const DOCUMENTATION_CARDS: DocumentationCard[] = [
  {
    title: "Getting Started",
    description: "Create a project and learn the basic platform workflow.",
    path: "getting-started",
    icon: RocketLaunchRoundedIcon,
  },
  {
    title: "Input Data",
    description: "Prepare, upload and explore PV and EV datasets.",
    path: "csv-format",
    icon: CloudUploadRoundedIcon,
  },
  {
    title: "Optimization",
    description: "Understand Single Battery Optimization and Battery Comparison.",
    path: "optimization-modes",
    icon: AutoGraphRoundedIcon,
  },
  {
    title: "Decision Making",
    description: "Learn how AHP weighting and PROMETHEE II ranking are used.",
    path: "ahp",
    icon: FactCheckRoundedIcon,
  },
  {
    title: "Results & Recovery",
    description: "Understand recommendations, detailed results and saved runs.",
    path: "final-results",
    icon: DescriptionRoundedIcon,
  },
  {
    title: "Further Information",
    description: "Read additional guidance about datasets, saved results and project state.",
    path: "further-information",
    icon: InfoOutlinedIcon,
  },
];

export default function DocumentationPage() {
  return (
    <Stack spacing={3}>
      <PageHeader
        eyebrow="USER GUIDE"
        title="Documentation"
        subtitle="Open the guide for each part of the BESS workflow."
        action={(
          <Button
            component="a"
            href={documentationUrl()}
            target="_blank"
            rel="noopener noreferrer"
            variant="contained"
            endIcon={<ArrowOutwardRoundedIcon />}
          >
            Open Full Documentation
          </Button>
        )}
      />

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "repeat(2,minmax(0,1fr))", lg: "repeat(3,minmax(0,1fr))" },
          gap: 2,
        }}
      >
        {DOCUMENTATION_CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <SurfaceCard key={card.title} sx={{ p: 2.5, minHeight: 210 }}>
              <Stack sx={{ height: "100%" }}>
                <Box
                  sx={{
                    display: "grid",
                    placeItems: "center",
                    width: 42,
                    height: 42,
                    borderRadius: 2.5,
                    color: "primary.main",
                    bgcolor: "rgba(155,239,74,.1)",
                  }}
                >
                  <Icon />
                </Box>
                <Typography component="h2" variant="h6" sx={{ mt: 2 }}>
                  {card.title}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.7 }}>
                  {card.description}
                </Typography>
                <Button
                  component="a"
                  href={documentationUrl(card.path)}
                  target="_blank"
                  rel="noopener noreferrer"
                  endIcon={<ArrowOutwardRoundedIcon />}
                  sx={{ mt: "auto", pt: 2, alignSelf: "flex-start" }}
                >
                  Open Guide
                </Button>
              </Stack>
            </SurfaceCard>
          );
        })}
      </Box>
    </Stack>
  );
}
