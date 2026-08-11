"use client";

import { AdminLayout } from "../layout-client";

type Project = {
  id: string;
  name: string;
  createdAt: Date;
  _count: { testRuns: number; members: number };
};

export function AdminProjectsClient({
  initialProjects,
}: {
  initialProjects: Project[];
}) {
  return (
    <AdminLayout>
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Projects</h2>
          <p className="text-sm text-muted-foreground">
            {initialProjects.length} project{initialProjects.length !== 1 ? "s" : ""} in this workspace
          </p>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">Project</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">Members</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">Test Runs</th>
                <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">Created</th>
              </tr>
            </thead>
            <tbody>
              {initialProjects.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No projects yet.
                  </td>
                </tr>
              ) : (
                initialProjects.map((project) => (
                  <tr key={project.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-medium">{project.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{project._count.members}</td>
                    <td className="px-4 py-3 text-muted-foreground">{project._count.testRuns}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(project.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AdminLayout>
  );
}
