// Enforces append-only access through the application's Mongoose models.
// Database administrators still require independently restricted database permissions.
module.exports = (schema) => {
  schema.pre("save", function () {
    if (!this.isNew) throw new Error("Append-only record cannot be modified");
  });
  for (const operation of ["updateOne", "updateMany", "replaceOne", "findOneAndUpdate", "findOneAndReplace", "findOneAndDelete", "deleteOne", "deleteMany"]) {
    schema.pre(operation, function () { throw new Error("Append-only record cannot be modified or deleted"); });
  }
  schema.pre("deleteOne", { document: true, query: false }, function () { throw new Error("Append-only record cannot be deleted"); });
  schema.pre("bulkWrite", function (next, operations) {
    if (operations.some(operation => !operation.insertOne)) return next(new Error("Append-only record cannot be modified or deleted"));
    next();
  });
};
