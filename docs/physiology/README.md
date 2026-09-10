# Physiological acoustic model implementation plan

This plan supersedes the existing application architecture. It attempts personalized physiological reconstruction, with two builders working by dependency gates rather than a fixed hackathon duration.

- [Main specification](singing-coach-spec.md)
- [Person A / Person B checklists](two-person-execution-plan.md)
- [Capture and depth detail](capture-and-depth-plan.md)
- [Shareable PDF](personalized-singing-coach.pdf)

Person A owns the backend and model. Person B owns unified audiovisual/depth acquisition, orchestration and independent evaluation. Main specification section 8 defines their integration contract.

Regenerate the PDF with `python build_report.py` in an environment containing ReportLab. The editable Markdown is authoritative. Background citations describe existing work, not results achieved by this project.
