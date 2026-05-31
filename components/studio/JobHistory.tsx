"use client";

import { useEffect, useRef, useState } from "react";

interface JobEntry {
  id: string;
  composition: string;
  status: string;
  url: string | null;
  error: string | null;
  createdAt: string;
}

export default function JobHistory({ refreshKey }: { refreshKey: number }) {
  const [jobs, setJobs] = useState<JobEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    async function fetchJobs() {
      setLoading(true);
      try {
        const res = await fetch("/api/jobs?limit=10");
        if (res.ok) {
          const data = (await res.json()) as { jobs: JobEntry[] };
          setJobs(data.jobs);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }

    fetchJobs();

    // Poll while any job is in progress
    pollRef.current = setInterval(() => {
      const hasActive = jobs.some(
        (j) => j.status !== "done" && j.status !== "failed",
      );
      if (hasActive) fetchJobs();
    }, 3000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refreshKey, jobs]);

  if (jobs.length === 0 && !loading) return null;

  return (
    <div className="job-history">
      <h3 className="job-history-title">Recent Jobs</h3>
      <div className="job-list">
        {jobs.map((job) => (
          <div key={job.id} className={`job-row status-${job.status}`}>
            <div className="job-info">
              <span className="job-composition">{job.composition}</span>
              <span className="job-status">{job.status}</span>
              <span className="job-time">
                {new Date(job.createdAt).toLocaleTimeString()}
              </span>
            </div>
            {job.url && (
              <a
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                className="job-link"
              >
                MP4
              </a>
            )}
            {job.error && (
              <span className="job-error" title={job.error}>
                Error
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
