import React from "react";
import L from "leaflet";
import { MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";
import "./ShipmentMap.css";
import { createShipmentMap } from "./ShipmentMapFactory";

const sharedMap = createShipmentMap({ React, Leaflet: L, MapContainer, Marker, Polyline, TileLayer, useMap });

export default sharedMap.ShipmentMap;
export const normalizeCoordinate = sharedMap.normalizeCoordinate;
export const normalizeRoutePoints = sharedMap.normalizeRoutePoints;
