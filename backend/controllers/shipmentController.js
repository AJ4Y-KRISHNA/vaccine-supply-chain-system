const Shipment = require("../models/Shipment");

exports.createShipment = async(req,res)=>{

try{

const shipment = await Shipment.create(req.body);

res.json(shipment);

}catch(err){

res.status(500).json(err);

}

};

exports.getShipments = async(req,res)=>{

try{

const shipments = await Shipment.find();

res.json(shipments);

}catch(err){

res.status(500).json(err);

}

};