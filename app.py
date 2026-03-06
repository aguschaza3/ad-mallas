from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

try:
    import boto3
except ImportError:  # boto3 is optional
    boto3 = None


BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATA_FILE = DATA_DIR / "wells.json"


DUMMY_WELLS = [
    {
        "id": "POZO-101",
        "injector": "I-101",
        "ranking": 1,
        "block_ranking": "A1",
        "field": "Loma Alta",
        "block": "Norte",
        "technical_approval": False,
        "reason": None,
        "checklist": {
            "productores_asociados": False,
            "mallas_vecinas": False,
            "historia_inyeccion": False,
            "chequear_dp_dp": False,
            "efectivizacion": False,
        },
        "mandrels": [
            {"name": "Mandril M-01", "selected": False},
            {"name": "Mandril M-02", "selected": False},
        ],
    },
    {
        "id": "POZO-205",
        "injector": "I-205",
        "ranking": 2,
        "block_ranking": "B3",
        "field": "Loma Alta",
        "block": "Sur",
        "technical_approval": False,
        "reason": None,
        "checklist": {
            "productores_asociados": True,
            "mallas_vecinas": True,
            "historia_inyeccion": False,
            "chequear_dp_dp": False,
            "efectivizacion": False,
        },
        "mandrels": [
            {"name": "Mandril M-07", "selected": False},
            {"name": "Mandril M-08", "selected": True},
        ],
    },
    {
        "id": "POZO-303",
        "injector": "I-303",
        "ranking": 3,
        "block_ranking": "C2",
        "field": "El Prado",
        "block": "Centro",
        "technical_approval": False,
        "reason": None,
        "checklist": {
            "productores_asociados": True,
            "mallas_vecinas": True,
            "historia_inyeccion": True,
            "chequear_dp_dp": True,
            "efectivizacion": True,
        },
        "mandrels": [
            {"name": "Mandril M-12", "selected": False},
            {"name": "Mandril M-13", "selected": False},
        ],
    },
]


class WellUpdate(BaseModel):
    technical_approval: bool | None = None
    reason: str | None = None
    checklist: dict[str, bool] | None = None
    mandrels: list[dict[str, Any]] | None = None
    operational_approval: bool | None = None
    operational_checklist: dict[str, bool] | None = None
    operational_observations: str | None = None
    validated_mandrels: list[dict[str, Any]] | None = None


class Storage:
    def __init__(self, data_file: Path) -> None:
        self.data_file = data_file
        self.s3_bucket = os.getenv("S3_BUCKET")
        self.s3_key = os.getenv("S3_KEY", "iwtt/wells.json")

    def _ensure_file(self) -> None:
        DATA_DIR.mkdir(exist_ok=True)
        if not self.data_file.exists():
            self.save(DUMMY_WELLS)

    def load(self) -> list[dict[str, Any]]:
        self._ensure_file()
        with self.data_file.open("r", encoding="utf-8") as f:
            return json.load(f)

    def save(self, wells: list[dict[str, Any]]) -> None:
        DATA_DIR.mkdir(exist_ok=True)
        with self.data_file.open("w", encoding="utf-8") as f:
            json.dump(wells, f, ensure_ascii=False, indent=2)
        self._save_to_s3(wells)

    def _save_to_s3(self, wells: list[dict[str, Any]]) -> None:
        if not self.s3_bucket or boto3 is None:
            return
        s3_client = boto3.client("s3")
        s3_client.put_object(
            Bucket=self.s3_bucket,
            Key=self.s3_key,
            Body=json.dumps(wells, ensure_ascii=False).encode("utf-8"),
            ContentType="application/json",
        )


storage = Storage(DATA_FILE)

app = FastAPI(title="Gestión Oportunidades IWTT")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(BASE_DIR / "static" / "index.html")


@app.get("/api/wells")
def list_wells() -> list[dict[str, Any]]:
    return storage.load()


@app.get("/api/wells/{well_id}")
def get_well(well_id: str) -> dict[str, Any]:
    wells = storage.load()
    well = next((w for w in wells if w["id"] == well_id), None)
    if well is None:
        raise HTTPException(status_code=404, detail="Pozo no encontrado")
    return well


@app.put("/api/wells/{well_id}")
def update_well(well_id: str, payload: WellUpdate) -> dict[str, Any]:
    wells = storage.load()
    index = next((i for i, w in enumerate(wells) if w["id"] == well_id), None)
    if index is None:
        raise HTTPException(status_code=404, detail="Pozo no encontrado")

    well = wells[index]

    if payload.checklist is not None:
        well["checklist"] = payload.checklist
        if not all(well["checklist"].values()):
            well["technical_approval"] = None
            well["reason"] = None

    if payload.mandrels is not None:
        well["mandrels"] = payload.mandrels

    if payload.technical_approval is not None:
        checklist_values = list((well.get("checklist") or {}).values())
        checklist_completed = bool(checklist_values) and all(checklist_values)
        if not checklist_completed:
            raise HTTPException(
                status_code=400,
                detail="Solo se puede definir la aprobación técnica cuando el checklist está completo.",
            )
        well["technical_approval"] = payload.technical_approval
        if not payload.technical_approval:
            well["reason"] = None

    if payload.reason is not None:
        if well.get("technical_approval") is not True:
            raise HTTPException(
                status_code=400,
                detail="Solo se puede elegir motivo cuando la aprobación técnica es SI.",
            )
        well["reason"] = payload.reason

    if payload.operational_approval is not None:
        if well.get("technical_approval") is not True:
            raise HTTPException(
                status_code=400,
                detail="Solo se puede cargar aprobación operativa para pozos validados técnicamente.",
            )
        operational_checklist_values = list((well.get("operational_checklist") or {}).values())
        if not operational_checklist_values or not all(operational_checklist_values):
            raise HTTPException(
                status_code=400,
                detail="Solo se puede definir la aprobación operativa cuando el checklist operativo está completo.",
            )
        well["operational_approval"] = payload.operational_approval

    if payload.operational_checklist is not None:
        well["operational_checklist"] = payload.operational_checklist
        if not all(well["operational_checklist"].values()):
            well["operational_approval"] = None

    if payload.operational_observations is not None:
        well["operational_observations"] = payload.operational_observations

    if payload.validated_mandrels is not None:
        well["validated_mandrels"] = payload.validated_mandrels

    wells[index] = well
    storage.save(wells)
    return well


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
