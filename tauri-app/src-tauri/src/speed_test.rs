//! Bounded streaming throughput tests. Bytes are discarded; URLs/credentials stay native.
use crate::{
    gateway::{Gateway, ResolvedMedia},
    settings::AppError,
};
use futures_util::StreamExt;
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;
#[derive(Clone, Copy, PartialEq, Serialize, Debug)]
#[serde(rename_all = "lowercase")]
enum Status {
    Running,
    Complete,
    Stopped,
    Error,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    id: String,
    account_id: String,
    status: Status,
    bytes: u64,
    total_bytes: Option<u64>,
    elapsed_ms: f64,
    current_mbps: f64,
    average_mbps: f64,
    minimum_mbps: f64,
    samples: Vec<f64>,
    error: Option<String>,
}
struct Record {
    snapshot: Snapshot,
    started: Instant,
    last: Instant,
    last_bytes: u64,
}
impl Record {
    fn sample(&mut self) {
        let now = Instant::now();
        let delta = now.duration_since(self.last).as_secs_f64().max(0.001);
        let speed = (self.snapshot.bytes - self.last_bytes) as f64 * 8.0 / delta / 1000000.0;
        self.snapshot.current_mbps = speed;
        self.snapshot.minimum_mbps = if self.snapshot.samples.is_empty() {
            speed
        } else {
            self.snapshot.minimum_mbps.min(speed)
        };
        self.snapshot.samples.push(speed);
        if self.snapshot.samples.len() > 128 {
            self.snapshot.samples.remove(0);
        }
        self.last = now;
        self.last_bytes = self.snapshot.bytes;
        self.snapshot.elapsed_ms = now.duration_since(self.started).as_secs_f64() * 1000.0;
        self.snapshot.average_mbps =
            self.snapshot.bytes as f64 * 8.0 / (self.snapshot.elapsed_ms.max(1.0) * 1000.0);
    }
    fn snapshot(&self) -> Snapshot {
        let mut snapshot = self.snapshot.clone();
        if snapshot.status == Status::Running {
            snapshot.elapsed_ms = self.started.elapsed().as_secs_f64() * 1000.0;
            snapshot.average_mbps =
                snapshot.bytes as f64 * 8.0 / (snapshot.elapsed_ms.max(1.0) * 1000.0);
        }
        snapshot
    }
    fn finish(&mut self, status: Status, error: Option<String>) {
        if self.snapshot.status != Status::Running {
            return;
        }
        if self.snapshot.samples.is_empty()
            || self.snapshot.bytes > self.last_bytes
            || self.last.elapsed() >= Duration::from_millis(250)
        {
            self.sample();
        } else {
            self.snapshot.elapsed_ms = self.started.elapsed().as_secs_f64() * 1000.0;
            self.snapshot.average_mbps =
                self.snapshot.bytes as f64 * 8.0 / (self.snapshot.elapsed_ms.max(1.0) * 1000.0);
        }
        self.snapshot.status = status;
        self.snapshot.error = error;
    }
}
struct Job {
    state: Mutex<Record>,
    cancel: CancellationToken,
}
#[derive(Default)]
pub struct SpeedTests(Mutex<HashMap<String, Arc<Job>>>);
fn error(message: &str) -> AppError {
    AppError::new("SPEED_TEST", message, false)
}
impl Drop for SpeedTests {
    fn drop(&mut self) {
        if let Ok(jobs) = self.0.lock() {
            for job in jobs.values() {
                job.cancel.cancel()
            }
        }
    }
}
impl SpeedTests {
    pub async fn start(
        &self,
        gateway: Arc<Gateway>,
        media: ResolvedMedia,
        parent: CancellationToken,
    ) -> Result<Snapshot, AppError> {
        self.start_for(gateway, media, parent, Duration::from_secs(20))
            .await
    }
    async fn start_for(
        &self,
        gateway: Arc<Gateway>,
        media: ResolvedMedia,
        parent: CancellationToken,
        window: Duration,
    ) -> Result<Snapshot, AppError> {
        // The caller serializes account removal with this registration.
        let proxy = gateway.register_test(media.clone()).await?;
        let job = Arc::new(Job {
            state: Mutex::new(Record {
                snapshot: Snapshot {
                    id: uuid::Uuid::new_v4().to_string(),
                    account_id: media.account_id,
                    status: Status::Running,
                    bytes: 0,
                    total_bytes: None,
                    elapsed_ms: 0.0,
                    current_mbps: 0.0,
                    average_mbps: 0.0,
                    minimum_mbps: 0.0,
                    samples: Vec::new(),
                    error: None,
                },
                started: Instant::now(),
                last: Instant::now(),
                last_bytes: 0,
            }),
            cancel: parent.child_token(),
        });
        let result = {
            let mut jobs = self.0.lock().unwrap();
            if jobs
                .values()
                .filter(|job| job.state.lock().unwrap().snapshot.status == Status::Running)
                .count()
                >= 2
            {
                Err(error("已有两个测速任务，请先停止其中一个"))
            } else {
                if jobs.len() >= 16 {
                    let oldest = jobs
                        .iter()
                        .filter(|(_, job)| {
                            job.state.lock().unwrap().snapshot.status != Status::Running
                        })
                        .min_by_key(|(_, job)| job.state.lock().unwrap().started)
                        .map(|(id, _)| id.clone());
                    if let Some(id) = oldest {
                        jobs.remove(&id);
                    }
                }
                let snapshot = job.state.lock().unwrap().snapshot();
                jobs.insert(snapshot.id.clone(), job.clone());
                Ok(snapshot)
            }
        };
        match result {
            Ok(snapshot) => {
                tokio::spawn(run(gateway, proxy, job, window));
                Ok(snapshot)
            }
            Err(error) => {
                gateway.revoke(&proxy).await;
                Err(error)
            }
        }
    }
    pub fn state(&self, id: &str) -> Result<Snapshot, AppError> {
        let job = self
            .0
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| error("测速记录已失效"))?;
        let snapshot = job.state.lock().unwrap().snapshot();
        Ok(snapshot)
    }
    pub fn cancel(&self, id: &str) -> Result<Snapshot, AppError> {
        let job = self
            .0
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| error("测速记录已失效"))?;
        job.cancel.cancel();
        let mut state = job.state.lock().unwrap();
        state.finish(Status::Stopped, None);
        Ok(state.snapshot())
    }
    pub fn cancel_account(&self, id: &str) {
        let jobs: Vec<_> = self.0.lock().unwrap().values().cloned().collect();
        for job in jobs {
            let mut state = job.state.lock().unwrap();
            if state.snapshot.account_id == id {
                job.cancel.cancel();
                state.finish(Status::Stopped, None)
            }
        }
    }
}
async fn run(gateway: Arc<Gateway>, proxy: String, job: Arc<Job>, window: Duration) {
    let read = async {
        let client = reqwest::Client::builder()
            .no_proxy()
            .build()
            .map_err(|_| error("无法初始化测速连接"))?;
        let response = client
            .get(&proxy)
            .header("cache-control", "no-cache")
            .send()
            .await
            .map_err(|_| error("无法读取服务器媒体"))?;
        if !response.status().is_success() {
            return Err(error(&format!(
                "服务器文件请求失败（{}）",
                response.status().as_u16()
            )));
        }
        if response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|value| {
                let value = value.to_ascii_lowercase();
                value.contains("mpegurl")
                    || value.contains("json")
                    || value.contains("xml")
                    || value.contains("text/html")
            })
        {
            return Err(error("服务器未返回可测速的媒体文件"));
        }
        job.state.lock().unwrap().snapshot.total_bytes = response.content_length();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| error("测速媒体传输中断"))?;
            let mut state = job.state.lock().unwrap();
            if state.snapshot.status != Status::Running {
                break;
            }
            state.snapshot.bytes = state.snapshot.bytes.saturating_add(chunk.len() as u64);
        }
        Ok::<(), AppError>(())
    };
    tokio::pin!(read);
    let mut interval = tokio::time::interval_at(
        tokio::time::Instant::now() + Duration::from_millis(250),
        Duration::from_millis(250),
    );
    let deadline = tokio::time::sleep(window);
    tokio::pin!(deadline);
    loop {
        tokio::select! {biased;_=job.cancel.cancelled()=>{job.state.lock().unwrap().finish(Status::Stopped,None);break},result=&mut read=>{let mut state=job.state.lock().unwrap();match result{Ok(())=>{if state.snapshot.bytes==0{state.finish(Status::Error,Some("服务器没有返回媒体数据".into()))}else{state.finish(Status::Complete,None)}},Err(error)=>state.finish(Status::Error,Some(error.message))}break},_=&mut deadline=>{let mut state=job.state.lock().unwrap();if state.snapshot.bytes==0{state.finish(Status::Error,Some("测速超时，未收到媒体数据".into()))}else{state.finish(Status::Complete,None)}break},_=interval.tick()=>{let mut state=job.state.lock().unwrap();if state.snapshot.status==Status::Running{state.sample()}}}
    }
    gateway.revoke(&proxy).await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gateway::tests::{fixture, gateway, media, SAMPLE};
    #[test]
    fn eof_does_not_add_a_spurious_zero_minimum_after_the_last_sample() {
        let now = Instant::now();
        let mut record = Record {
            snapshot: Snapshot {
                id: "test".into(),
                account_id: "a".into(),
                status: Status::Running,
                bytes: 250000,
                total_bytes: Some(250000),
                elapsed_ms: 250.0,
                current_mbps: 8.0,
                average_mbps: 8.0,
                minimum_mbps: 8.0,
                samples: vec![8.0],
                error: None,
            },
            started: now - Duration::from_millis(250),
            last: now,
            last_bytes: 250000,
        };
        record.finish(Status::Complete, None);
        assert_eq!(record.snapshot.minimum_mbps, 8.0);
        assert_eq!(record.snapshot.samples, vec![8.0]);
    }
    async fn terminal(tests: &SpeedTests, id: &str) -> Snapshot {
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let state = tests.state(id).unwrap();
            if state.status != Status::Running {
                return state;
            }
            assert!(Instant::now() < deadline, "speed test did not finish");
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    }
    async fn cleaned(gateway: &Gateway) {
        let deadline = Instant::now() + Duration::from_secs(2);
        while gateway.test_resource_count().await != 0 {
            assert!(Instant::now() < deadline, "speed resource was not revoked");
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    }
    #[tokio::test]
    async fn complete_and_denied_tests_report_real_bytes_without_refreshing_to_other_media() {
        let fixture = fixture().await;
        let gateway = gateway(&fixture);
        let tests = SpeedTests::default();
        let started = tests
            .start(
                gateway.clone(),
                media(&fixture.base, "/media"),
                CancellationToken::new(),
            )
            .await
            .unwrap();
        let finished = terminal(&tests, &started.id).await;
        assert_eq!(finished.status, Status::Complete);
        assert_eq!(finished.bytes, SAMPLE.len() as u64);
        assert!(finished.average_mbps > 0.0);
        assert!(!finished.samples.is_empty());
        let public = serde_json::to_string(&finished).unwrap();
        assert!(!public.contains("Bearer"));
        assert!(!public.contains("http://"));
        cleaned(&gateway).await;
        let denied = tests
            .start(
                gateway.clone(),
                media(&fixture.base, "/expired"),
                CancellationToken::new(),
            )
            .await
            .unwrap();
        let failed = terminal(&tests, &denied.id).await;
        assert_eq!(failed.status, Status::Error);
        assert_eq!(failed.bytes, 0);
        assert!(failed.error.unwrap().contains("403"));
        assert_eq!(
            fixture.refreshes.load(std::sync::atomic::Ordering::SeqCst),
            0
        );
        cleaned(&gateway).await;
        let metadata = tests
            .start(
                gateway.clone(),
                media(&fixture.base, "/headers"),
                CancellationToken::new(),
            )
            .await
            .unwrap();
        let failed = terminal(&tests, &metadata.id).await;
        assert_eq!(failed.status, Status::Error);
        assert_eq!(failed.bytes, 0);
        assert!(!serde_json::to_string(&failed).unwrap().contains("Bearer"));
        cleaned(&gateway).await;
    }
    async fn slow() -> (
        String,
        tokio::task::JoinHandle<()>,
        Arc<std::sync::atomic::AtomicUsize>,
    ) {
        use axum::{
            body::Body,
            http::{HeaderMap, StatusCode},
            response::IntoResponse,
            routing::get,
            Router,
        };
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let recorded = calls.clone();
        let router = Router::new().route(
            "/file",
            get(move |headers: HeaderMap| {
                let calls = recorded.clone();
                async move {
                    calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    if headers.get("authorization").and_then(|v| v.to_str().ok())
                        != Some("Bearer test-account")
                    {
                        return StatusCode::FORBIDDEN.into_response();
                    }
                    let stream = futures_util::stream::unfold(0u8, |stage| async move {
                        if stage == 0 {
                            Some((Ok::<_, std::io::Error>(vec![0u8; 262144]), 1))
                        } else {
                            tokio::time::sleep(Duration::from_secs(60)).await;
                            None
                        }
                    });
                    ([("content-type", "video/mp4")], Body::from_stream(stream)).into_response()
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        (base, task, calls)
    }
    #[tokio::test]
    async fn logout_cancellation_is_account_bound_and_running_jobs_are_limited() {
        let (base, task, _) = slow().await;
        let fixture = fixture().await;
        let gateway = gateway(&fixture);
        let tests = SpeedTests::default();
        let mut first = media(&base, "/file");
        first.account_id = "a".into();
        let mut second = first.clone();
        second.account_id = "b".into();
        let a = tests
            .start(gateway.clone(), first.clone(), CancellationToken::new())
            .await
            .unwrap();
        let b = tests
            .start(gateway.clone(), second, CancellationToken::new())
            .await
            .unwrap();
        assert!(tests
            .start(gateway.clone(), first, CancellationToken::new())
            .await
            .is_err());
        assert_eq!(gateway.test_resource_count().await, 2);
        tests.cancel_account("a");
        assert_eq!(tests.state(&a.id).unwrap().status, Status::Stopped);
        assert_eq!(tests.state(&b.id).unwrap().status, Status::Running);
        tests.cancel(&b.id).unwrap();
        cleaned(&gateway).await;
        task.abort();
    }
    #[tokio::test]
    async fn sample_window_and_preparation_cancellation_are_bounded() {
        let (base, task, calls) = slow().await;
        let fixture = fixture().await;
        let gateway = gateway(&fixture);
        let tests = SpeedTests::default();
        let parent = CancellationToken::new();
        parent.cancel();
        let cancelled = tests
            .start(gateway.clone(), media(&base, "/file"), parent)
            .await
            .unwrap();
        assert_eq!(
            terminal(&tests, &cancelled.id).await.status,
            Status::Stopped
        );
        cleaned(&gateway).await;
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 0);
        let started = tests
            .start_for(
                gateway.clone(),
                media(&base, "/file"),
                CancellationToken::new(),
                Duration::from_millis(120),
            )
            .await
            .unwrap();
        let finished = terminal(&tests, &started.id).await;
        assert_eq!(finished.status, Status::Complete);
        assert_eq!(finished.bytes, 262144);
        assert!(finished.elapsed_ms >= 100.0);
        cleaned(&gateway).await;
        task.abort();
    }
}
