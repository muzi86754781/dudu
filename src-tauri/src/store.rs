use crate::model::*;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

pub struct Store {
    db: Connection,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        let entry = keyring::Entry::new("com.dudu.desktop", "database-v1").map_err(err)?;
        let secret = match entry.get_password() {
            Ok(v) => v,
            Err(keyring::Error::NoEntry) if !path.exists() => {
                let v = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
                entry
                    .set_password(&v)
                    .map_err(|_| "系统凭据库不可用，无法安全保存数据密钥".to_string())?;
                v
            }
            Err(_) => {
                return Err(
                    "无法读取系统密钥。请恢复系统凭据库；为保护原数据，dudu 不会重建数据库。".into(),
                )
            }
        };
        Self::open_key(path, &secret)
    }

    fn open_key(path: &Path, key: &str) -> Result<Self> {
        if key.len() != 64 || !key.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err("数据库密钥格式错误".into());
        }
        let db = Connection::open(path).map_err(err)?;
        db.pragma_update(None, "key", format!("x'{key}'")).map_err(err)?;
        db.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON; PRAGMA foreign_keys=ON;",
        )
        .map_err(err)?;
        let version: i64 = db
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(err)?;
        if version > 1 {
            return Err("数据库来自更新版本，请升级 dudu 后打开".into());
        }
        db.execute_batch(
            "BEGIN; CREATE TABLE IF NOT EXISTS clipboard_items(id TEXT PRIMARY KEY,kind TEXT NOT NULL,content TEXT NOT NULL,preview TEXT NOT NULL,source TEXT NOT NULL,created INTEGER NOT NULL,favorite INTEGER NOT NULL DEFAULT 0,title TEXT NOT NULL DEFAULT '');CREATE INDEX IF NOT EXISTS clips_date ON clipboard_items(created DESC);CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE IF NOT EXISTS translate_cache(id TEXT PRIMARY KEY,text TEXT NOT NULL,result TEXT NOT NULL,engine TEXT NOT NULL,from_lang TEXT NOT NULL,to_lang TEXT NOT NULL,created INTEGER NOT NULL);PRAGMA user_version=1;COMMIT;",
        )
        .map_err(err)?;
        let health: String = db.query_row("PRAGMA quick_check", [], |r| r.get(0)).map_err(err)?;
        if health != "ok" {
            return Err("数据完整性检查失败，请保留数据库并恢复备份".into());
        }
        Ok(Self { db })
    }

    pub fn settings(&self) -> Result<Settings> {
        let json: Option<String> = self
            .db
            .query_row("SELECT value FROM settings WHERE key='preferences'", [], |r| {
                r.get(0)
            })
            .optional()
            .map_err(err)?;
        json.map(|j| serde_json::from_str(&j).map_err(err))
            .unwrap_or(Ok(Settings::default()))
    }

    pub fn save_settings(&self, s: &Settings) -> Result<()> {
        s.validate()?;
        self.db
            .execute(
                "INSERT INTO settings VALUES('preferences',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                [serde_json::to_string(s).map_err(err)?],
            )
            .map_err(err)?;
        self.prune(s.limit)
    }

    pub fn list(&self, full: bool) -> Result<Vec<Clip>> {
        let mut stmt = self.db.prepare(if full {
            "SELECT id,kind,content,source,created,favorite,title FROM clipboard_items ORDER BY favorite DESC,created DESC LIMIT 5000"
        } else {
            "SELECT id,kind,CASE WHEN kind='image' THEN preview ELSE content END,source,created,favorite,title FROM clipboard_items ORDER BY favorite DESC,created DESC LIMIT 5000"
        }).map_err(err)?;
        let rows = stmt.query_map([], read_clip).map_err(err)?;
        rows.collect::<std::result::Result<Vec<_>, _>>().map_err(err)
    }

    pub fn clip(&self, id: &str) -> Result<Clip> {
        self.db
            .query_row(
                "SELECT id,kind,content,source,created,favorite,title FROM clipboard_items WHERE id=?1",
                [id],
                read_clip,
            )
            .map_err(|_| "记录已不存在".into())
    }

    pub fn insert(&self, c: &Clip, preview: &str, limit: usize) -> Result<()> {
        self.db.execute(
            "INSERT OR IGNORE INTO clipboard_items VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
            params![c.id, c.kind, c.content, preview, c.source, c.created, c.favorite, c.title],
        ).map_err(err)?;
        self.prune(limit)
    }

    pub fn is_recent_duplicate(&self, kind: &str, content: &str, within_ms: i64) -> bool {
        let result: rusqlite::Result<Option<i64>> = self
            .db
            .query_row(
                "SELECT created FROM clipboard_items WHERE kind=?1 AND content=?2 ORDER BY created DESC LIMIT 1",
                params![kind, content],
                |r| r.get(0),
            )
            .optional();
        matches!(result, Ok(Some(t)) if now() - t < within_ms)
    }

    pub fn prune(&self, limit: usize) -> Result<()> {
        let favorites: usize = self
            .db
            .query_row("SELECT COUNT(*) FROM clipboard_items WHERE favorite=1", [], |r| {
                r.get(0)
            })
            .map_err(err)?;
        self.db.execute(
            "DELETE FROM clipboard_items WHERE favorite=0 AND id NOT IN (SELECT id FROM clipboard_items WHERE favorite=0 ORDER BY created DESC LIMIT ?1)",
            [limit.saturating_sub(favorites)],
        ).map_err(err)?;
        Ok(())
    }

    pub fn favorite(&self, id: &str) -> Result<()> {
        self.db
            .execute("UPDATE clipboard_items SET favorite=1-favorite WHERE id=?1", [id])
            .map_err(err)?;
        Ok(())
    }

    pub fn delete(&self, id: &str) -> Result<()> {
        self.db
            .execute("DELETE FROM clipboard_items WHERE id=?1", [id])
            .map_err(err)?;
        Ok(())
    }

    pub fn edit(&self, id: &str, title: &str, content: &str) -> Result<()> {
        if content.len() > 128 * 1024 || title.len() > 512 {
            return Err("片段内容或标题过长".into());
        }
        self.db.execute(
            "UPDATE clipboard_items SET content=?2,title=?3 WHERE id=?1 AND kind='text'",
            params![id, content, title],
        ).map_err(err)?;
        Ok(())
    }

    pub fn cached(&self, id: &str) -> Result<Option<Translation>> {
        self.db
            .query_row(
                "SELECT id,text,result,engine,from_lang,to_lang,created FROM translate_cache WHERE id=?1 AND created>?2",
                params![id, now() - 86400000],
                read_translation,
            )
            .optional()
            .map_err(err)
    }

    pub fn cache(&self, t: &Translation) -> Result<()> {
        self.db.execute(
            "INSERT OR REPLACE INTO translate_cache VALUES(?1,?2,?3,?4,?5,?6,?7)",
            params![t.id, t.text, t.result, t.engine, t.from, t.to, t.created],
        ).map_err(err)?;
        self.db.execute(
            "DELETE FROM translate_cache WHERE id NOT IN (SELECT id FROM translate_cache ORDER BY created DESC LIMIT 30) OR created<?1",
            [now() - 86400000],
        ).map_err(err)?;
        Ok(())
    }

    pub fn history(&self) -> Result<Vec<Translation>> {
        let mut stmt = self.db.prepare(
            "SELECT id,text,result,engine,from_lang,to_lang,created FROM translate_cache WHERE created>?1 ORDER BY created DESC LIMIT 30",
        ).map_err(err)?;
        let rows = stmt.query_map([now() - 86400000], read_translation).map_err(err)?;
        rows.collect::<std::result::Result<Vec<_>, _>>().map_err(err)
    }

    pub fn clear(&self) -> Result<()> {
        self.db
            .execute_batch("DELETE FROM clipboard_items;DELETE FROM translate_cache;PRAGMA wal_checkpoint(TRUNCATE);VACUUM;")
            .map_err(err)
    }
}

fn read_clip(r: &rusqlite::Row<'_>) -> rusqlite::Result<Clip> {
    Ok(Clip {
        id: r.get(0)?,
        kind: r.get(1)?,
        content: r.get(2)?,
        source: r.get(3)?,
        created: r.get(4)?,
        favorite: r.get(5)?,
        title: r.get(6)?,
    })
}

fn read_translation(r: &rusqlite::Row<'_>) -> rusqlite::Result<Translation> {
    Ok(Translation {
        id: r.get(0)?,
        text: r.get(1)?,
        result: r.get(2)?,
        engine: r.get(3)?,
        from: r.get(4)?,
        to: r.get(5)?,
        created: r.get(6)?,
        cached: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encrypted_roundtrip_and_retention() {
        let path = std::env::temp_dir().join(format!("dudu-test-{}.db", uuid::Uuid::new_v4()));
        let key = "a".repeat(64);
        {
            let db = Store::open_key(&path, &key).unwrap();
            let clip = |i: i64, favorite: bool| Clip {
                id: i.to_string(),
                kind: "text".into(),
                content: "private test content".into(),
                source: "Editor".into(),
                created: i,
                favorite,
                title: "".into(),
            };
            for i in 0..105 {
                db.insert(&clip(i, i == 0), "", 100).unwrap();
            }
            assert_eq!(db.list(false).unwrap().len(), 100);
            assert_eq!(db.list(false).unwrap()[0].id, "0");
            assert!(db.clip("1").is_err());
            db.edit("104", "edited", "new content").unwrap();
            assert_eq!(db.clip("104").unwrap().content, "new content");
        }
        let raw = std::fs::read(&path).unwrap();
        assert_ne!(&raw[..16], b"SQLite format 3\0");
        assert!(Store::open_key(&path, &"b".repeat(64)).is_err());
        {
            let db = Store::open_key(&path, &key).unwrap();
            assert_eq!(db.list(false).unwrap().len(), 100);
            db.clear().unwrap();
            assert!(db.list(false).unwrap().is_empty());
        }
        let _ = std::fs::remove_file(path);
    }
}
