{{/*
Expand the name of the chart.
*/}}
{{- define "dask-gateway-pack.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "dask-gateway-pack.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "dask-gateway-pack.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "dask-gateway-pack.labels" -}}
helm.sh/chart: {{ include "dask-gateway-pack.chart" . }}
{{ include "dask-gateway-pack.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "dask-gateway-pack.selectorLabels" -}}
app.kubernetes.io/name: {{ include "dask-gateway-pack.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Fullname as computed BY THE SUBCHART (dask-gateway/_helpers.tpl):
if the release name contains "dask-gateway" the subchart uses the release
name alone; otherwise it appends "-dask-gateway". We mirror that logic here
so we can derive the subchart's Service names without hardcoding a release
name. A subchart-level fullnameOverride (dask-gateway.fullnameOverride) wins.
*/}}
{{- define "dask-gateway-pack.gateway-fullname" -}}
{{- $sub := index .Values "dask-gateway" | default dict }}
{{- if $sub.fullnameOverride }}
{{- $sub.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := $sub.nameOverride | default "dask-gateway" }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
The subchart's gateway api Service name: api-<fullname> (ClusterIP :8000).
This is the NebariApp's backend — the ONLY thing exposed through Envoy.
*/}}
{{- define "dask-gateway-pack.api-service-name" -}}
{{ include "dask-gateway-pack.gateway-fullname" . | printf "api-%s" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
The subchart's Traefik proxy Service name: traefik-<fullname>.
IN-CLUSTER ONLY (ClusterIP): scheduler TCP proxy (SNI passthrough) and
per-cluster dashboard proxy for in-cluster clients (JupyterLab pods /
dask-labextension). Never referenced by the NebariApp.
*/}}
{{- define "dask-gateway-pack.traefik-service-name" -}}
{{ include "dask-gateway-pack.gateway-fullname" . | printf "traefik-%s" | trunc 63 | trimSuffix "-" }}
{{- end }}
