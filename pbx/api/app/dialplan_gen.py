"""Generate per-tenant dialplan files carrying BLF hints.

Each tenant gets ``<dialplan_dir>/tenant-<slug>.conf`` defining a context
``[tenant-<slug>]`` that includes ``from-internal`` and declares a ``hint`` for
every extension:

    [tenant-acme]
    include => from-internal
    exten => 1001,hint,PJSIP/acme-1001
    exten => 1002,hint,PJSIP/acme-1002

Endpoints are placed in this context (see provisioning.py), so a phone that
SUBSCRIBEs to extension 1001 gets that hint's device state — i.e. busy-lamp
field. Asterisk #includes dialplan/tenant-*.conf from extensions.conf. After
writing, callers run `dialplan reload` via AMI.

Files are written atomically; a tenant with no extensions still gets a valid
context so the include never errors.
"""
from __future__ import annotations

import os
import re

from . import db
from .config import settings

_SLUG_RE = re.compile(r"^[a-z][a-z0-9-]{1,38}[a-z0-9]$")


def _path(slug: str) -> str:
    return os.path.join(settings.dialplan_dir, f"tenant-{slug}.conf")


async def regenerate_tenant(slug: str) -> str:
    """(Re)write the tenant's hint context file. Returns the file path."""
    if not _SLUG_RE.match(slug):
        raise ValueError("invalid slug")
    rows = await db.fetch(
        """SELECT e.extension, e.endpoint_id
           FROM extensions e JOIN tenants t ON t.id = e.tenant_id
           WHERE t.slug = $1 ORDER BY e.extension""",
        slug)

    lines = [
        f"; AUTO-GENERATED for tenant '{slug}' — do not edit by hand.",
        f"[tenant-{slug}]",
        "include => from-internal",
    ]
    for r in rows:
        # exten => <number>,hint,PJSIP/<slug>-<number>
        lines.append(f"exten => {r['extension']},hint,PJSIP/{r['endpoint_id']}")
    content = "\n".join(lines) + "\n"

    os.makedirs(settings.dialplan_dir, exist_ok=True)
    path = _path(slug)
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        fh.write(content)
    os.replace(tmp, path)        # atomic
    return path


async def remove_tenant(slug: str) -> None:
    try:
        os.remove(_path(slug))
    except OSError:
        pass
