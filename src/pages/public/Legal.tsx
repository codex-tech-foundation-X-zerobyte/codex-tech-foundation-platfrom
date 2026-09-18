import { ContentPage } from './ContentPage'

export function Privacy() {
  return (
    <ContentPage eyebrow="Legal" title="Privacy Policy" lead="How Codex Tech Foundation handles information submitted through this site and platform.">
      <section>
        <h2>Information we collect</h2>
        <p>
          We collect the information you provide directly — through contact forms, project enquiries, job
          applications, and authenticated use of the client or worker platform — along with standard technical
          data needed to operate the site securely.
        </p>
      </section>
      <section>
        <h2>How we use it</h2>
        <p>
          Submitted information is used to respond to enquiries, evaluate applications, deliver contracted work,
          and operate accounts within the platform. We do not sell personal information.
        </p>
      </section>
      <section>
        <h2>Data storage and access</h2>
        <p>
          Platform data is stored in Supabase with row-level security restricting access to authorised users.
          Files such as resumes and project documents are held in private storage and are not publicly
          accessible.
        </p>
      </section>
      <section>
        <h2>Contact</h2>
        <p>Questions about this policy can be sent through the Contact page.</p>
      </section>
    </ContentPage>
  )
}

export function Terms() {
  return (
    <ContentPage eyebrow="Legal" title="Terms &amp; Conditions" lead="The terms that govern use of this website and the Codex Tech Foundation platform.">
      <section>
        <h2>Use of this site</h2>
        <p>
          This site and platform are provided for evaluating and engaging Codex Tech Foundation's services.
          Access to worker, admin, and client areas is restricted to authorised accounts.
        </p>
      </section>
      <section>
        <h2>Client engagements</h2>
        <p>
          Specific project scope, timelines, and pricing are governed by the individual agreement signed with
          each client, not by this page.
        </p>
      </section>
      <section>
        <h2>Changes</h2>
        <p>These terms may be updated from time to time. Continued use of the platform constitutes acceptance of the current version.</p>
      </section>
    </ContentPage>
  )
}
