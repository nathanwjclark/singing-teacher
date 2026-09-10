# Physiological acoustic model implementation plan

This plan supersedes the existing application architecture. It attempts personalized physiological reconstruction, with two human leads coordinating parallel Astra agents through dependency gates rather than a fixed hackathon duration.

- [Main specification](singing-coach-spec.md)
- [Parallel-agent lanes, dependencies and human checklists](two-person-execution-plan.md)
- [Capture and depth detail](capture-and-depth-plan.md)
- [Shareable PDF](personalized-singing-coach.pdf)

Revision 5: Person A leads scientific modeling and numerical acceptance. Person B leads unified audiovisual/depth acquisition, orchestration, independent evaluation and the repository integration queue. The execution plan assigns eleven agent lanes, a runnable contract kit, acceptance experiments and dependency-driven activation. Main specification section 8 preserves the synchronized acquisition/fusion contract.

The PDF includes the main specification and complete parallel-agent execution appendix. Regenerate it with `python docs/physiology/build_report.py` from the repository root in an environment containing ReportLab. The editable Markdown is authoritative. Background citations describe existing work, not results achieved by this project.
