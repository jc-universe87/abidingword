//! The example project (v0.19): added only when asked, built from content
//! inside the app (no internet), and never twice.

use abiding_word_lib::db::{studies, teaching, Database};
use abiding_word_lib::domain::ListStudies;
use abiding_word_lib::sample;
use rusqlite::Connection;

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

#[test]
fn the_example_project_is_added_once_and_is_ordinary_work() {
    let db = Database::open_in_memory().unwrap();
    db.with_conn(|conn| {
        // Nothing is there until asked for.
        assert_eq!(count(conn, "SELECT COUNT(*) FROM projects"), 0);
        let first = sample::install(conn)?;
        assert!(first.added);
        assert_eq!(first.title, "Example: Abiding in Christ — John 15:1–11");

        let list = studies::list(
            conn,
            &ListStudies {
                project_id: Some(first.project_id.clone()),
                ..Default::default()
            },
        )?;
        assert_eq!(list.len(), 1);
        let study = studies::get_detail(conn, &list[0].id)?;
        assert_eq!(study.study.title, "Abiding in the True Vine");
        let text = |key: &str| {
            study
                .sections
                .iter()
                .find(|s| s.key.as_deref() == Some(key))
                .unwrap()
                .blocks[0]
                .content
                .clone()
        };
        assert!(text("observations").contains("“remain”"));
        assert!(count(conn, "SELECT COUNT(*) FROM findings") >= 7);

        let preps = teaching::list(conn, &study.study.id)?;
        let kinds: Vec<_> = preps
            .iter()
            .map(|p| p.kind.clone().unwrap_or_default())
            .collect();
        assert_eq!(kinds, ["sermon", "bible_study", "lesson"]);
        let lesson = teaching::get(conn, &preps[2].id)?;
        assert_eq!(lesson.points.len(), 4);
        assert_eq!(lesson.points[1].kind.as_deref(), Some("scripture"));
        assert!(!lesson.points[0].explanation.is_empty());
        assert!(lesson
            .central_message
            .as_deref()
            .unwrap_or("")
            .contains("Stay connected"));

        // Again: nothing more.
        let again = sample::install(conn)?;
        assert!(!again.added);
        assert_eq!(again.project_id, first.project_id);
        assert_eq!(count(conn, "SELECT COUNT(*) FROM projects"), 1);
        assert_eq!(count(conn, "SELECT COUNT(*) FROM studies"), 1);

        // Deleted by the person: it can be added again.
        conn.execute(
            "UPDATE projects SET deleted_at = '2026-10-22' WHERE id = ?1",
            [&first.project_id],
        )?;
        let third = sample::install(conn)?;
        assert!(third.added);
        assert_ne!(third.project_id, first.project_id);
        Ok(())
    })
    .unwrap();
}
