import { ContentPage } from './ContentPage'

export function About() {
  return (
    <ContentPage
      eyebrow="About"
      title="Technology should create room to think."
      lead="Codex Tech Foundation is a product engineering studio. We design and build the systems that let ambitious teams operate with less friction and more confidence."
    >
      <section>
        <h2>Mission</h2>
        <p>
          We exist to close the gap between what a growing organisation needs from its software and what it's
          actually running on. Most teams aren't short on ambition — they're working around systems that were
          never designed for what the business became.
        </p>
      </section>
      <section>
        <h2>Philosophy</h2>
        <p>
          Durable software is a byproduct of clear thinking, not extra tooling. We spend real time in discovery
          before writing code, because the cost of building the wrong thing well is always higher than the cost
          of building the right thing slowly.
        </p>
      </section>
      <section>
        <h2>Approach</h2>
        <p>
          Every engagement moves through the same disciplined path — discover, define, design, build, validate,
          launch, improve — adapted to the size of the problem. Small projects move through it in days; platform
          builds move through it in cycles.
        </p>
      </section>
      <section>
        <h2>Technology</h2>
        <p>
          We choose technology for its ability to be maintained by someone other than us, a year from now.
          That usually means well-understood, well-supported tools rather than the newest ones — applied with
          real engineering discipline around data, access control, and operational visibility.
        </p>
      </section>
    </ContentPage>
  )
}
